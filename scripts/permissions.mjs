import { readFileSync, existsSync } from "node:fs";
import { loadConfig, matchAny, fail } from "./lib.mjs";

const WRITING_TOOLS = ["Edit", "Write", "NotebookEdit"];

/**
 * Rend les chemins refuses a chaque role, depuis `file_policy`.
 *
 * @param config - configuration du projet
 * @returns les globs refuses par role, roles sans refus exclus
 */
function denialsByRole(config) {
  const policy = config.file_policy ?? {};
  const out = new Map();
  for (const [role, rules] of Object.entries(policy)) {
    const deny = rules?.deny ?? [];
    if (deny.length > 0) out.set(role, [...deny].sort());
  }
  return out;
}

/**
 * Rend un chemin representatif d'un glob, pour tester sa couverture.
 *
 * Comparer deux globs par egalite de chaines est faux : `**` couvre
 * `.sudocode/**` sans lui ressembler. On teste donc un chemin concret que le
 * glob designe, contre les motifs de l'autre role.
 *
 * @param glob - le motif a representer
 * @returns un chemin que ce motif designe
 */
function representative(glob) {
  return glob.replaceAll("**/", "x/").replaceAll("**", "x").replaceAll("*", "x").replaceAll("?", "x");
}

/**
 * Rend les chemins qu'AUCUN role n'a le droit d'ecrire.
 *
 * Une plateforme dont les permissions sont globales a la session ne sait pas
 * exprimer « ce role-ci ne peut pas ecrire ici, celui-la si ». Un chemin
 * qu'au moins un role a le droit d'ecrire ne peut donc pas etre refuse
 * globalement sans casser ce role.
 *
 * Un role autorise un chemin quand sa liste `allow` le couvre, ou quand sa
 * liste `deny` ne le couvre pas, ou quand il n'a aucune politique.
 *
 * @param config - configuration du projet
 * @param candidates - les globs a examiner
 * @returns les globs refusables globalement, tries
 */
function universalDenials(config, candidates) {
  const policy = config.file_policy ?? {};

  return candidates
    .filter((glob) => {
      const path = representative(glob);
      return !Object.values(policy).some((rules) => {
        if (rules?.allow != null) return matchAny(path, rules.allow);
        if (rules?.deny != null) return !matchAny(path, rules.deny);
        return true;
      });
    })
    .sort();
}

/**
 * Rend les regles de refus au format d'une plateforme d'agents.
 *
 * @param globs - les chemins a refuser
 * @returns les regles `Outil(motif)`
 */
function toRules(globs) {
  return globs.flatMap((glob) => WRITING_TOOLS.map((tool) => `${tool}(${glob})`));
}

/**
 * Verifie qu'un fichier de reglages refuse bien chaque chemin attendu.
 *
 * @param path - chemin du fichier de reglages
 * @param expected - les regles attendues
 */
function check(path, expected) {
  if (expected.length === 0) {
    console.log(
      "AUCUNE regle derivable : chaque chemin refuse a un role est autorise a un autre.\n" +
        "Des permissions globales a la session ne peuvent pas imposer cette file_policy — les refus\n" +
        "restent des consignes de prompt. Ce controle ne prouve donc rien ici, et son succes n'est\n" +
        "pas une garantie : c'est l'absence de garantie.",
    );
    return;
  }

  if (!existsSync(path)) fail(`introuvable : ${path}`);

  let settings;
  try {
    settings = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${path} n'est pas un JSON valide : ${error.message}`);
  }

  const deny = settings.permissions?.deny ?? [];
  const missing = expected.filter((rule) => !deny.includes(rule));

  if (missing.length > 0) {
    console.error(`${path} ne refuse pas :`);
    for (const rule of missing) console.error(`  ${rule}`);
    fail(
      `${missing.length} regle(s) manquante(s). file_policy declare des refus que la plateforme n'impose pas : ` +
        `ce sont des consignes de prompt, pas des barrieres.`,
    );
  }
  console.log(`${path} impose les ${expected.length} regles derivees de file_policy.`);
}

/**
 * Derive les permissions de plateforme depuis `file_policy`.
 *
 * `AGENTS.md` exige que les permissions soient imposees par la plateforme et
 * previent qu'une interdiction ecrite dans un prompt n'est pas une barriere
 * de securite. Rien ne les derivait pourtant : `file_policy` etait injectee
 * dans les regles machine et repetee dans les prompts, et s'arretait la.
 *
 * Ce script ne configure aucune plateforme — il n'en connait aucune. Il rend
 * la politique deja declaree sous une forme applicable, et sait verifier
 * qu'un fichier de reglages la porte vraiment.
 *
 * Usage : node permissions.mjs [--format claude]
 *         node permissions.mjs --check <fichier-de-reglages>
 */
function main() {
  const args = process.argv.slice(2);
  const config = loadConfig();
  const byRole = denialsByRole(config);

  if (byRole.size === 0) fail("file_policy ne declare aucun refus : rien a deriver.");

  const candidates = [...new Set([...byRole.values()].flat())];
  const universal = universalDenials(config, candidates);
  const checkIndex = args.indexOf("--check");

  if (checkIndex !== -1) {
    const path = args[checkIndex + 1];
    if (!path) fail("usage : permissions.mjs --check <fichier-de-reglages>");
    check(path, toRules(universal));
    return;
  }

  const formatIndex = args.indexOf("--format");
  const format = formatIndex === -1 ? "neutre" : args[formatIndex + 1];

  if (format === "claude") {
    console.log(JSON.stringify({ permissions: { deny: toRules(universal) } }, null, 2));
    return;
  }

  console.log("Refus declares par file_policy, role par role :\n");
  for (const [role, globs] of byRole) {
    console.log(`  ${role}`);
    for (const glob of globs) console.log(`    ${glob}`);
  }

  console.log(`\nRefuses a TOUS les roles, donc traduisibles en permission globale (${universal.length}) :\n`);
  for (const glob of universal) console.log(`  ${glob}`);

  const partial = candidates.filter((glob) => !universal.includes(glob));
  if (partial.length > 0) {
    console.log(
      `\nRefuses a certains roles seulement (${new Set(partial).size}) : une plateforme dont les permissions\n` +
        `sont globales a la session ne peut pas les imposer sans bloquer aussi les roles autorises.\n` +
        `Ils restent a la charge d'une configuration par agent, ou demeurent de simples consignes.\n`,
    );
    for (const glob of new Set(partial)) console.log(`  ${glob}`);
  }
}

main();
