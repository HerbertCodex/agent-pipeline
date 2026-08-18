import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(here, "..", "scripts");
const PROJECT_ROOT = join(here, "..", "..");

/**
 * Resout le fichier de regles du projet hote depuis sa configuration.
 *
 * Le chemin n'est pas ecrit en dur : `rules_path` est configurable, et un
 * harnais qui suppose `pipeline/rules.json` ne tournerait que sur les projets
 * qui ont garde le defaut. Le core ne suppose ni langage ni arborescence.
 *
 * @returns le chemin absolu du fichier de regles du projet hote
 */
function resolveRules() {
  const config = JSON.parse(readFileSync(join(PROJECT_ROOT, "pipeline.config.json"), "utf8"));
  return join(PROJECT_ROOT, config.rules_path);
}

/**
 * Cree un depot jetable portant une configuration de pipeline minimale.
 *
 * Les scripts du core resolvent `pipeline.config.json` depuis le repertoire
 * courant : un bac a sable par test isole donc completement l'etat, et aucun
 * test ne peut ecrire dans le store du projet reel.
 *
 * Les regles sont copiees depuis le fichier `rules_path` du projet hote
 * plutot que reinventees. Un jeu de regles de test diverge de la production
 * sans que rien ne le signale, et les tests finissent par prouver la copie
 * au lieu du systeme. Le reste de la configuration du bac a sable est en
 * revanche fabrique : ses chemins et sa politique de fichiers n'appartiennent
 * qu'au test, et ne supposent rien du projet hote.
 *
 * @param options - contenu initial : `issues` et `specs`, listes de records
 * @returns le chemin du bac a sable, a supprimer avec `destroySandbox`
 */
export function createSandbox({ issues = [], specs = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "pipeline-core-"));
  mkdirSync(join(root, "pipeline", "store"), { recursive: true });

  cpSync(resolveRules(), join(root, "pipeline", "rules.json"));

  writeFileSync(
    join(root, "pipeline.config.json"),
    JSON.stringify({
      profile: "test",
      profiles_dir: "agent-pipeline/profiles",
      commands: { check: "true" },
      docs_dirs: ["agent-pipeline/docs"],
      briefs_dir: "pipeline/briefs",
      prompts_dir: ".claude/agents",
      skills_dir: ".claude/skills",
      rules_path: "pipeline/rules.json",
      project_context: "pipeline/project-context.md",
      store_dir: "pipeline/store",
      ci: { provider: "none" },
      file_policy: {
        implementer: { allow: ["src/**", "test/**"], deny: ["package.json"] },
        product: { allow: [] },
        qa: { allow: [] },
        orchestrator: { allow: ["pipeline/store/**"] },
      },
    }),
  );

  writeStore(root, "issues", issues);
  writeStore(root, "specs", specs);
  return root;
}

/**
 * Supprime un bac a sable et tout son contenu.
 *
 * @param root - chemin rendu par `createSandbox`
 */
export function destroySandbox(root) {
  rmSync(root, { recursive: true, force: true });
}

/**
 * Reecrit un fichier du store a partir d'une liste de records.
 *
 * @param root - chemin du bac a sable
 * @param kind - `issues` ou `specs`
 * @param records - records a serialiser, une ligne chacun
 */
export function writeStore(root, kind, records) {
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  writeFileSync(join(root, "pipeline", "store", `${kind}.jsonl`), records.length > 0 ? `${body}\n` : "");
}

/**
 * Relit un record du store par son identifiant.
 *
 * @param root - chemin du bac a sable
 * @param kind - `issues` ou `specs`
 * @param id - identifiant du record
 * @returns le record, ou `undefined` s'il est absent
 */
export function readRecord(root, kind, id) {
  const path = join(root, "pipeline", "store", `${kind}.jsonl`);
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line))
    .find((record) => record.id === id);
}

/**
 * Rend le hash de verrou optimiste d'un record, tel que le core le calcule.
 *
 * Le hash porte sur la ligne brute et non sur le record reserialise : un
 * reformatage sans effet semantique change le hash, et c'est voulu.
 *
 * @param root - chemin du bac a sable
 * @param kind - `issues` ou `specs`
 * @param id - identifiant du record
 * @returns le hash hexadecimal attendu par `store-update`
 */
export function recordHash(root, kind, id) {
  const path = join(root, "pipeline", "store", `${kind}.jsonl`);
  const line = readFileSync(path, "utf8")
    .split("\n")
    .find((candidate) => candidate.trim().length > 0 && JSON.parse(candidate).id === id);
  return createHash("sha256").update(line, "utf8").digest("hex");
}

/**
 * Ecrit un fichier JSON dans le bac a sable et rend son chemin absolu.
 *
 * @param root - chemin du bac a sable
 * @param name - nom du fichier
 * @param value - contenu serialisable
 * @returns le chemin absolu du fichier ecrit
 */
export function writeJson(root, name, value) {
  const path = join(root, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

/**
 * Execute un script du core dans le bac a sable.
 *
 * @param root - chemin du bac a sable, utilise comme repertoire courant
 * @param script - nom de fichier du script, par exemple `store-update.mjs`
 * @param args - arguments de ligne de commande
 * @returns le code de sortie et les deux flux de sortie
 */
export function run(root, script, args = []) {
  const result = spawnSync(process.execPath, [join(SCRIPTS, script), ...args], {
    cwd: root,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

/**
 * Construit un bloc `pipeline_state` valide.
 *
 * @param overrides - champs a remplacer dans l'etat par defaut
 * @returns un bloc d'etat accepte par la validation du core
 */
export function state(overrides = {}) {
  return {
    schema_version: 1,
    phase: "planned",
    owner: "orchestrator",
    version: 1,
    qa_code_rejections: 0,
    file_reservations: ["src/x/**"],
    last_commit_sha: null,
    last_transition_at: null,
    ...overrides,
  };
}

/**
 * Construit une issue de test complete.
 *
 * @param overrides - champs a remplacer dans le record par defaut
 * @returns un record d'issue accepte par le store
 */
export function issue(overrides = {}) {
  return {
    id: "i-t1",
    spec_id: "s-t1",
    title: "issue de test",
    depends_on: [],
    acceptance_criteria: ["1. [unit] premier critere", "2. [unit] second critere"],
    pipeline_state: state(),
    ...overrides,
  };
}
