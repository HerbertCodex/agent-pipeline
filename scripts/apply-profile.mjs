import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig, loadRules, fail } from "./lib.mjs";
import { ARCHITECTURES, PROJECT_TYPES } from "./architectures.mjs";

const CI_TEMPLATE = "agent-pipeline/templates/ci.template.yml";
const AGENTS_TEMPLATE = "agent-pipeline/templates/AGENTS.template.md";
const PROMPTS_SRC = "agent-pipeline/prompts";
const CLAUDE_TEMPLATE = "agent-pipeline/templates/CLAUDE.template.md";
const SKILLS_SRC = "agent-pipeline/skills";
const RULES_SRC = "agent-pipeline/schemas/rules.json";
const CI_OUT = ".github/workflows/ci.yml";
const AGENTS_OUT = "AGENTS.md";
const CLAUDE_OUT = "CLAUDE.md";
const PORTING_GUIDE = "agent-pipeline/docs/nouveau-profil.md";
const ROLES = ["orchestrator", "product", "implementer", "qa"];

/**
 * Rend `AGENTS.md` depuis son template et les invariants du profil.
 *
 * Le document s'annonce assemble depuis son template depuis toujours, mais
 * rien ne l'assemblait : il etait ecrit a la main, libre de deriver de sa
 * source sans que rien ne le signale. C'est le niveau 2 de l'ordre de
 * priorite, au-dessus des prompts — le dernier endroit ou une derive
 * silencieuse est acceptable.
 *
 * Les invariants vivent par profil et non dans le template, parce qu'ils sont
 * la seule partie du document qui parle de la stack. Changer de stack, c'est
 * ecrire ce fichier-la, et rien d'autre.
 *
 * @param config - configuration du projet
 * @returns le contenu rendu de AGENTS.md
 */
function renderAgents(config) {
  if (!existsSync(AGENTS_TEMPLATE)) fail(`introuvable : ${AGENTS_TEMPLATE}`);

  const invariantsPath = join(config.profiles_dir, config.profile, "invariants.md");
  if (!existsSync(invariantsPath)) {
    fail(
      `introuvable : ${invariantsPath}\n` +
        `Le profil "${config.profile}" n'a pas d'invariants. Un profil sans invariants rendrait ` +
        `un AGENTS.md dont la section 9 est vide, donc une politique muette sur la stack.\n` +
        `Ecrire ce fichier est la premiere etape de ${PORTING_GUIDE}.`,
    );
  }

  const invariants = readFileSync(invariantsPath, "utf8").trim();
  if (invariants.length === 0) fail(`${invariantsPath} est vide`);

  let text = readFileSync(AGENTS_TEMPLATE, "utf8")
    .replaceAll("{{profile}}", config.profile)
    .replaceAll("{{profile_invariants}}", invariants);

  const unresolved = text.match(/\{\{[a-z._]+\}\}/);
  if (unresolved) fail(`${AGENTS_TEMPLATE}: variable non resolue ${unresolved[0]}`);
  return text;
}

/**
 * Extrait un bloc nomme de la source de contexte du projet.
 *
 * Meme idiome que les balises `<!-- brief:<roles> -->` lues par sync-briefs :
 * un document reste lisible pour un humain tout en portant des sections
 * destinees a une cible generee.
 *
 * @param text - contenu de la source de contexte
 * @param name - nom du bloc, sans son prefixe
 * @param source - chemin du document, pour les messages d'erreur
 * @returns le contenu du bloc, balises retirees
 */
function projectBlock(text, name, source) {
  const open = `<!-- claude:${name} -->\n`;
  const start = text.indexOf(open);
  if (start === -1) fail(`${source}: bloc <!-- claude:${name} --> absent`);
  const from = start + open.length;
  const end = text.indexOf("\n<!-- /claude -->", from);
  if (end === -1) fail(`${source}: bloc claude:${name} non ferme`);
  const body = text.slice(from, end).trim();
  if (body.length === 0) fail(`${source}: bloc claude:${name} vide`);
  return body;
}

/**
 * Rend `CLAUDE.md` depuis son template et le contexte du projet.
 *
 * Ce fichier est charge a chaque session : c'est lui qui porte l'obligation de
 * demander « pipeline ou direct » avant d'agir. Rien ne le rendait et aucun
 * document ne l'exigeait, alors qu'il compte dans l'empreinte de
 * configuration : un depot ou le pipeline venait d'etre porte demarrait donc
 * sans point d'entree, et cette obligation n'avait lieu pour personne.
 *
 * Le contexte vit hors du template parce qu'il est la seule partie du document
 * qui parle du depot et non du pipeline — meme partage que les invariants de
 * profil pour `AGENTS.md`.
 *
 * @returns le contenu rendu de CLAUDE.md
 */
function renderClaude(config) {
  if (!existsSync(CLAUDE_TEMPLATE)) fail(`introuvable : ${CLAUDE_TEMPLATE}`);
  const contextPath = config.project_context;
  if (!existsSync(contextPath)) {
    fail(
      `introuvable : ${contextPath}\n` +
        `Sans lui, CLAUDE.md serait rendu sans ce qui est vrai de ce depot : ni commandes ` +
        `locales, ni limites assumees, pour toute session neuve.\n` +
        `Ecrire ce fichier est une etape de ${PORTING_GUIDE}.`,
    );
  }

  const source = readFileSync(contextPath, "utf8");
  const text = readFileSync(CLAUDE_TEMPLATE, "utf8")
    .replaceAll("{{project_summary}}", projectBlock(source, "summary", contextPath))
    .replaceAll("{{project_commands}}", projectBlock(source, "commands", contextPath))
    .replaceAll("{{project_context}}", projectBlock(source, "context", contextPath));

  const unresolved = text.match(/\{\{[a-z._]+\}\}/);
  if (unresolved) fail(`${CLAUDE_TEMPLATE}: variable non resolue ${unresolved[0]}`);
  return text;
}

/**
 * Rend les prompts de roles depuis leurs sources, chemin des briefs
 * injecte depuis la config.
 *
 * @param config - configuration du projet
 * @returns le contenu rendu par nom de fichier de prompt
 */
function renderPrompts(config) {
  if (!existsSync(PROMPTS_SRC)) fail(`introuvable : ${PROMPTS_SRC}`);
  const rendered = new Map();
  for (const file of readdirSync(PROMPTS_SRC).filter((f) => f.endsWith(".md")).sort()) {
    const text = readFileSync(join(PROMPTS_SRC, file), "utf8").replaceAll("{{briefs_dir}}", config.briefs_dir);
    const unresolved = text.match(/\{\{[a-z._]+\}\}/);
    if (unresolved) fail(`${PROMPTS_SRC}/${file}: variable non resolue ${unresolved[0]}`);
    rendered.set(file, text);
  }
  return rendered;
}

/**
 * Rend les fichiers d'une racine, recursivement, chemins relatifs a elle.
 *
 * @param root - racine a parcourir
 * @param prefix - prefixe accumule pendant la descente
 * @returns les chemins relatifs, separateurs normalises
 */
function walkRelative(root, prefix = "") {
  if (!existsSync(root)) return [];
  let found = [];
  for (const entry of readdirSync(root).sort()) {
    const absolute = join(root, entry);
    const relative = prefix.length === 0 ? entry : `${prefix}/${entry}`;
    if (statSync(absolute).isDirectory()) found = found.concat(walkRelative(absolute, relative));
    else found.push(relative);
  }
  return found;
}

/**
 * Collecte les skills a installer : ceux du core, puis ceux du profil.
 *
 * Les deux sources sont disjointes par construction — le core ne porte que ce
 * qui ne depend d'aucune stack, le profil ce qui en depend. Un meme nom des
 * deux cotes est une erreur de rangement, pas une surcharge : elle est refusee
 * plutot que resolue silencieusement.
 *
 * @param config - configuration du projet
 * @returns le contenu a installer, par chemin relatif a skills_dir
 */
function collectSkills(config) {
  const profileSkills = join(config.profiles_dir, config.profile, "skills");
  const wanted = new Map();
  const origin = new Map();

  for (const [source, label] of [
    [SKILLS_SRC, "core"],
    [profileSkills, `profil ${config.profile}`],
  ]) {
    for (const relative of walkRelative(source)) {
      const skill = relative.split("/")[0];
      const previous = origin.get(skill);
      if (previous != null && previous !== label) {
        fail(
          `skill "${skill}" present dans ${previous} et dans ${label}.\n` +
            `Un skill appartient au core s'il ne depend d'aucune stack, au profil sinon. Jamais aux deux.`,
        );
      }
      origin.set(skill, label);
      wanted.set(relative, readFileSync(join(source, relative)));
    }
  }
  return wanted;
}

/**
 * Installe les skills dans `skills_dir`, ou constate la derive.
 *
 * Un skill injecte des instructions dans un agent. L'installer comme une cible
 * generee est ce qui rend cette injection auditable : la source est relue une
 * fois, et toute divergence de la copie installee est signalee avant qu'un
 * agent ne la lise.
 *
 * @param config - configuration du projet
 * @param checkMode - vrai pour comparer sans ecrire
 * @returns vrai si une derive a ete constatee en mode verification
 */
function applySkills(config, checkMode) {
  const wanted = collectSkills(config);
  const target = config.skills_dir;

  if (wanted.size === 0) {
    if (existsSync(target) && walkRelative(target).length > 0) {
      console.error(`desynchronise : ${target} peuple alors qu'aucun skill n'est fourni`);
      return true;
    }
    return false;
  }

  const present = new Set(walkRelative(target));
  let drift = false;

  if (checkMode) {
    for (const [relative, content] of wanted) {
      const path = join(target, relative);
      if (!existsSync(path)) {
        console.error(`absent : ${path}`);
        drift = true;
      } else if (!readFileSync(path).equals(content)) {
        console.error(`desynchronise : ${path}`);
        drift = true;
      }
      present.delete(relative);
    }
    for (const orphan of present) {
      console.error(`en trop : ${join(target, orphan)}`);
      drift = true;
    }
    return drift;
  }

  for (const orphan of present) {
    if (!wanted.has(orphan)) rmSync(join(target, orphan), { force: true });
  }
  for (const [relative, content] of wanted) {
    const path = join(target, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  const names = new Set([...wanted.keys()].map((relative) => relative.split("/")[0]));
  console.log(`ecrit : ${target}/ (${names.size} skills, ${wanted.size} fichiers)`);
  return false;
}

/**
 * Refuse une configuration qui ne declare pas comment le code est range.
 *
 * `render-architecture` explique les options et l'operateur tranche, mais un
 * choix qui reste dans une page HTML n'engage personne : l'agent qui installe
 * le profil range comme il l'entend, et le suivant range autrement. Le choix
 * n'existe que s'il est ecrit quelque part qu'une porte relit.
 *
 * Le core ne juge pas l'architecture retenue — `custom` est une reponse
 * valable. Il exige qu'elle soit nommee, et qu'elle vaille pour le type de
 * projet declare : proposer des ports et des adaptateurs a une interface web
 * est un catalogue recopie, pas une decision.
 *
 * @param config - configuration du projet hote
 */
function checkArchitecture(config) {
  const chosen = config.architecture;
  if (chosen == null || typeof chosen !== "object") {
    fail(
      "architecture manquante : declarez { id, project_type }. Le cadre ne choisit pas a votre place, " +
        "mais un choix qui ne vit que dans une page HTML n'engage aucun agent — chacun rangera le code " +
        "a sa facon, et la derive sera invisible parce que rien ne dit de quoi elle derive. " +
        "Lancez render-architecture.mjs pour trancher, puis ecrivez le resultat ici.",
    );
  }
  if (typeof chosen.project_type !== "string" || PROJECT_TYPES[chosen.project_type] == null) {
    fail(
      `architecture.project_type invalide : attendu l'un de ${Object.keys(PROJECT_TYPES).join(", ")}. ` +
        "Le type change la reponse, pas seulement le vocabulaire.",
    );
  }
  if (typeof chosen.id !== "string" || chosen.id.length === 0) {
    fail("architecture.id manquant : nommez le rangement retenu, ou \"custom\" s'il n'est dans aucun catalogue.");
  }
  if (chosen.id === "custom") {
    if (typeof chosen.note !== "string" || chosen.note.trim().length === 0) {
      fail("architecture.id vaut \"custom\" : la note qui decrit le rangement retenu devient la seule reference. Elle est obligatoire.");
    }
    return;
  }
  const known = ARCHITECTURES.find((item) => item.id === chosen.id);
  if (known == null) {
    fail(
      `architecture.id inconnu : "${chosen.id}". Connus : ${ARCHITECTURES.map((item) => item.id).join(", ")}, ` +
        "ou \"custom\" avec une note.",
    );
  }
  if (!known.applies.includes(chosen.project_type)) {
    fail(
      `architecture "${chosen.id}" ne s'applique pas a un projet ${chosen.project_type} ` +
        `(elle vaut pour : ${known.applies.join(", ")}). Un choix hors type est un nom recopie, pas une decision.`,
    );
  }
}

/**
 * Applique le profil au depot : file_policy injectee dans les regles,
 * `AGENTS.md` rendu depuis son template et les invariants du profil,
 * `CLAUDE.md` rendu depuis son template et le contexte du projet,
 * workflow CI rendu depuis le template et les commandes du profil,
 * prompts de roles rendus dans prompts_dir avec le chemin des briefs.
 *
 * Mode --check : compare sans ecrire, code 1 en derive. Toute commande
 * ajoutee a la config devient automatiquement une etape CI.
 */
function main() {
  const checkMode = process.argv.includes("--check");
  const config = loadConfig();

  for (const key of ["check", "lint", "build", "test_unit", "audit", "secrets_scan", "project_map"]) {
    if (typeof config.commands[key] !== "string") fail(`commands.${key} manquante ou invalide`);
  }
  if (typeof config.commands.design_limits !== "string") {
    fail(
      "commands.design_limits manquante : le core ne connait pas votre outil, mais il exige qu'une porte " +
        "borne complexite, longueur de fonction, nombre de parametres et profondeur d'imbrication. " +
        "Ce sont des approximations mesurables de ce que la responsabilite unique et KISS protegent ; " +
        "sans porte, elles s'auto-annulent et le code n'est bon que si le modele l'est.",
    );
  }
  checkArchitecture(config);
  for (const role of Object.keys(config.file_policy)) {
    if (!ROLES.includes(role)) fail(`file_policy: role inconnu "${role}"`);
  }
  for (const role of ["implementer"]) {
    if (config.file_policy[role] == null) fail(`file_policy.${role} est obligatoire`);
  }

  const RULES_PATH = config.rules_path;
  if (!existsSync(RULES_PATH)) {
    if (checkMode) {
      fail(
        `absent : ${RULES_PATH}\n` +
          `Le fichier de regles n'a jamais ete amorce. Lancer apply-profile sans --check : ` +
          `il le seme depuis ${RULES_SRC}.`,
      );
    }
    if (!existsSync(RULES_SRC)) fail(`introuvable : ${RULES_SRC}`);
    mkdirSync(dirname(RULES_PATH), { recursive: true });
    writeFileSync(RULES_PATH, readFileSync(RULES_SRC));
    console.log(`seme : ${RULES_PATH} (depuis ${RULES_SRC})`);
  }

  const rules = loadRules(RULES_PATH);
  const currentPolicy = JSON.stringify(rules.file_policy ?? null);
  const wantedPolicy = JSON.stringify(config.file_policy);
  const ciEnabled = config.ci.provider !== "none";

  let ci = "";
  if (ciEnabled) {
  if (!existsSync(CI_TEMPLATE)) fail(`introuvable : ${CI_TEMPLATE}`);
  ci = readFileSync(CI_TEMPLATE, "utf8");
  const vars = {
    profile: config.profile,
    install: config.ci.install,
    "runtime.uses": config.ci.runtime_setup.uses,
    "runtime.with": Object.entries(config.ci.runtime_setup.with)
      .map(([k, v]) => `          ${k}: ${v}`)
      .join("\n"),
    steps: Object.entries(config.commands)
      .map(([key, cmd]) => `      - name: ${key.replaceAll("_", "-")}\n        run: ${cmd}`)
      .join("\n\n"),
  };
  for (const [key, value] of Object.entries(vars)) ci = ci.replaceAll(`{{${key}}}`, value);
  const unresolved = ci.match(/\{\{[a-z._]+\}\}/);
  if (unresolved) fail(`${CI_TEMPLATE}: variable non resolue ${unresolved[0]}`);
  }

  const prompts = renderPrompts(config);
  const agents = renderAgents(config);
  const claude = renderClaude(config);

  if (checkMode) {
    let drift = false;
    const currentAgents = existsSync(AGENTS_OUT) ? readFileSync(AGENTS_OUT, "utf8") : "";
    if (currentAgents !== agents) {
      console.error(`desynchronise : ${AGENTS_OUT}`);
      drift = true;
    }
    const currentClaude = existsSync(CLAUDE_OUT) ? readFileSync(CLAUDE_OUT, "utf8") : "";
    if (currentClaude !== claude) {
      console.error(`desynchronise : ${CLAUDE_OUT}`);
      drift = true;
    }
    for (const [file, text] of prompts) {
      const outPath = join(config.prompts_dir, file);
      const current = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
      if (current !== text) {
        console.error(`desynchronise : ${outPath}`);
        drift = true;
      }
    }
    if (currentPolicy !== wantedPolicy) {
      console.error(`desynchronise : ${RULES_PATH} file_policy`);
      drift = true;
    }
    if (ciEnabled) {
      const currentCi = existsSync(CI_OUT) ? readFileSync(CI_OUT, "utf8") : "";
      if (currentCi !== ci) {
        console.error(`desynchronise : ${CI_OUT}`);
        drift = true;
      }
    } else if (existsSync(CI_OUT)) {
      console.error(`desynchronise : ${CI_OUT} present alors que ci.provider est "none"`);
      drift = true;
    }
    if (applySkills(config, true)) drift = true;
    if (drift) fail("Profil non applique.");
    console.log("Profil applique et synchronise.");
  } else {
    rules.file_policy = config.file_policy;
    writeFileSync(RULES_PATH, JSON.stringify(rules, null, "\t") + "\n");
    console.log(`ecrit : ${RULES_PATH} (file_policy du profil ${config.profile})`);
    writeFileSync(AGENTS_OUT, agents);
    console.log(`ecrit : ${AGENTS_OUT} (invariants du profil ${config.profile})`);
    writeFileSync(CLAUDE_OUT, claude);
    console.log(`ecrit : ${CLAUDE_OUT} (contexte de ${config.project_context})`);
    if (ciEnabled) {
      mkdirSync(dirname(CI_OUT), { recursive: true });
      writeFileSync(CI_OUT, ci);
      console.log(`ecrit : ${CI_OUT}`);
    } else {
      console.log(`ci.provider "none" : aucun workflow rendu, la preuve de cloture est la batterie locale complete de QA`);
    }
    mkdirSync(config.prompts_dir, { recursive: true });
    for (const [file, text] of prompts) {
      writeFileSync(join(config.prompts_dir, file), text);
    }
    console.log(`ecrit : ${config.prompts_dir}/ (${prompts.size} prompts, briefs -> ${config.briefs_dir})`);
    applySkills(config, false);
  }
}

main();
