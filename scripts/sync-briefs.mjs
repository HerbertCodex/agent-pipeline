import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { loadConfig, fail } from "./lib.mjs";

const ROLES = ["orchestrator", "product", "implementer", "qa"];
const OPEN_RE = /<!--\s*brief:([a-z-,\s]+?)\s*-->/g;
const CLOSE_TAG = "<!-- /brief -->";

/**
 * Extrait les blocs balises brief d'un document, avec garde anti-imbrication.
 *
 * @param source - chemin du document, pour les messages d'erreur
 * @param text - contenu du document
 * @returns les blocs avec leurs roles cibles
 */
function extractBlocks(source, text) {
  const blocks = [];
  let match;
  OPEN_RE.lastIndex = 0;
  while ((match = OPEN_RE.exec(text)) !== null) {
    const roles = match[1].split(",").map((r) => r.trim()).filter(Boolean);
    const start = match.index + match[0].length;
    const end = text.indexOf(CLOSE_TAG, start);
    if (end === -1) fail(`${source}: balise brief non fermee a l'offset ${match.index}`);
    if (text.slice(start, end).includes("<!-- brief:")) {
      fail(`${source}: balise brief imbriquee dans le bloc ouvert a l'offset ${match.index}`);
    }
    for (const role of roles) {
      if (!ROLES.includes(role)) fail(`${source}: role inconnu "${role}"`);
    }
    blocks.push({ roles, content: text.slice(start, end).trim() });
    OPEN_RE.lastIndex = end + CLOSE_TAG.length;
  }
  return blocks;
}

/**
 * Compile un brief par role depuis les documents balises et la config.
 *
 * Chaque brief ouvre sur la table des commandes du profil, puis empile
 * les sections balisees pour ce role, dans l'ordre des repertoires puis
 * des fichiers. Mode --check : compare sans ecrire, code 1 en derive.
 */
function main() {
  const checkMode = process.argv.includes("--check");
  const config = loadConfig();
  const perRole = Object.fromEntries(ROLES.map((r) => [r, []]));

  for (const dir of config.docs_dirs) {
    if (!existsSync(dir)) fail(`repertoire de documents introuvable : ${dir}`);
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
      const text = readFileSync(join(dir, file), "utf8");
      for (const block of extractBlocks(join(dir, file), text)) {
        for (const role of block.roles) {
          perRole[role].push({ source: basename(file), content: block.content });
        }
      }
    }
  }

  const commandsSection = [
    "## Commandes du projet",
    "",
    `Profil : ${config.profile}. Quand une regle ou un prompt nomme une commande par sa cle (check, lint, test_unit, audit...), c'est la commande ci-dessous qu'il faut executer.`,
    "",
    ...Object.entries(config.commands).map(([key, cmd]) => `- ${key} : \`${cmd}\``),
  ].join("\n");

  let drift = false;
  for (const role of ROLES) {
    const sections = perRole[role].map((b) => `## Source : ${b.source}\n\n${b.content}`).join("\n\n");
    const output = [
      `# Brief compile : ${role}`,
      "",
      "GENERE par agent-pipeline/scripts/sync-briefs.mjs. Ne pas editer.",
      "En cas de doute ou de conflit, le document source fait foi.",
      "",
      commandsSection,
      "",
      sections,
      "",
    ].join("\n");
    const outPath = join(config.briefs_dir, `${role}.md`);
    if (checkMode) {
      const current = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
      if (current !== output) {
        console.error(`desynchronise : ${outPath}`);
        drift = true;
      }
    } else {
      mkdirSync(config.briefs_dir, { recursive: true });
      writeFileSync(outPath, output);
      console.log(`ecrit : ${outPath} (${perRole[role].length} sections)`);
    }
  }
  if (checkMode && drift) fail("Briefs desynchronises. Lancer la compilation.");
  if (checkMode) console.log("Briefs synchronises.");
}

main();
