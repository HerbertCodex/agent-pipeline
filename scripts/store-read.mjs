import { join } from "node:path";
import { loadConfig, readJsonl, sha256, fail } from "./lib.mjs";

const ADDRESSEE = /^#+\s*Context for ([A-Za-z][A-Za-z -]*?)\s*(\(|$)/;

/**
 * Rend le role auquel un bloc de contexte s'adresse.
 *
 * Le titre porte deja son destinataire — `## Context for QA`,
 * `## Context for Implementer (REGRESSION)`. Un bloc qui n'en nomme aucun,
 * comme une preuve de cloture, ne s'adresse a personne en particulier.
 *
 * @param heading - Titre du bloc de contexte.
 * @returns Le role en minuscules, ou `null` quand le bloc n'est pas adresse.
 */
function addresseeOf(heading) {
  const match = ADDRESSEE.exec(heading ?? "");
  return match == null ? null : match[1].trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * Reduit les contextes a ce dont un role a besoin pour travailler.
 *
 * Trois coupes, dans cet ordre. Les blocs adresses a un autre role ne
 * voyagent pas : ils n'ont jamais ete ecrits pour celui-ci. Les blocs non
 * adresses non plus — une preuve de cloture est de l'audit, pas une consigne,
 * et c'etait la moitie du poids sur l'issue la plus lourde mesuree. Enfin un
 * meme titre se remplace : seule la derniere consigne est vivante,
 * l'anterieure est de l'histoire.
 *
 * Ce n'est pas resumer. Un bloc qui voyage voyage ENTIER : resumer ferait
 * combler les trous par le lecteur, et combler est indistinguable de
 * fabriquer. Filtrer par destinataire ne touche a aucun texte transmis.
 *
 * @param contexts - Blocs persistes sur le record, du plus ancien au plus recent.
 * @param role - Role destinataire, en minuscules.
 * @returns Les blocs vivants adresses a ce role.
 */
function contextsFor(contexts, role) {
  const latest = new Map();
  for (const block of contexts ?? []) {
    if (addresseeOf(block.heading) !== role) continue;
    latest.set(block.heading, block);
  }
  return [...latest.values()];
}

/**
 * Affiche un record du store avec son hash de verrou optimiste.
 *
 * `--for <role>` reduit les contextes a ceux qui s'adressent a ce role. Le
 * record complet reste sur disque : la piste d'audit est intacte, seule la
 * lecture est bornee. Le hash rendu reste celui de la ligne entiere, pour que
 * le verrou optimiste porte sur le record reel et non sur la vue.
 *
 * Usage : node store-read.mjs <issue|spec> <id> [--for <role>]
 * Sortie JSON : { id, record_hash, state_version, record }
 */
function main() {
  const args = process.argv.slice(2);
  const forIndex = args.indexOf("--for");
  const role = forIndex === -1 ? null : args[forIndex + 1]?.toLowerCase();
  const positional =
    forIndex === -1
      ? args
      : args.filter((_, index) => index !== forIndex && index !== forIndex + 1);
  const [kind, id] = positional;

  if (kind !== "issue" && kind !== "spec") fail("usage : store-read.mjs <issue|spec> <id> [--for <role>]");
  if (!id) fail("usage : store-read.mjs <issue|spec> <id> [--for <role>]");
  if (forIndex !== -1 && !role) fail("--for attend un role");

  const config = loadConfig();
  const path = join(config.store_dir, `${kind}s.jsonl`);
  const entry = readJsonl(path).find((e) => e.record.id === id);
  if (entry == null) fail(`record not found: ${id} in ${path}`);

  const record =
    role == null
      ? entry.record
      : { ...entry.record, contexts: contextsFor(entry.record.contexts, role) };

  const output = {
    id,
    record_hash: sha256(entry.raw),
    state_version: entry.record.pipeline_state?.version ?? null,
    record,
  };
  console.log(JSON.stringify(output, null, "\t"));
}

main();
