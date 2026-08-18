import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

/**
 * Charge et valide minimalement la configuration de profil du projet.
 *
 * Une configuration incomplete arrete le processus par un message, jamais par
 * une trace de pile : ces scripts s'adressent a un operateur, et un chemin
 * manquant dans un fichier de config n'est pas un defaut de programmation.
 *
 * @param path - chemin du fichier de config, racine du projet par defaut
 * @returns la configuration parsee, ou jamais si elle est invalide
 */
export function loadConfig(path = "pipeline.config.json") {
  if (!existsSync(path)) fail(`introuvable : ${path} (lancer depuis la racine du projet)`);
  let config;
  try {
    config = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${path}: JSON invalide (${error.message})`);
  }
  for (const key of ["profile", "profiles_dir", "commands", "docs_dirs", "briefs_dir", "prompts_dir", "skills_dir", "rules_path", "project_context", "file_policy", "store_dir", "ci"]) {
    if (config[key] == null) fail(`${path}: cle manquante "${key}"`);
  }
  return config;
}

/**
 * Charge la source machine des regles du pipeline.
 *
 * Sans argument, le chemin vient de `rules_path` dans la configuration : le
 * projet hote decide donc ou ranger ce fichier, comme pour tous les autres
 * repertoires du pipeline.
 *
 * @param path - chemin du fichier de regles, `rules_path` de la config par defaut
 * @returns les regles parsees, ou jamais si le fichier manque
 */
export function loadRules(path) {
  const resolved = path ?? loadConfig().rules_path;
  if (!existsSync(resolved)) fail(`introuvable : ${resolved}`);
  return JSON.parse(readFileSync(resolved, "utf8"));
}

/**
 * Lit un fichier JSONL en preservant chaque ligne brute.
 *
 * La ligne brute est la cle du verrou optimiste : son hash change au
 * moindre octet, y compris un reformatage sans effet semantique.
 *
 * @param path - chemin du fichier JSONL
 * @returns une entree par ligne non vide, avec la ligne brute et le record parse
 * @throws {SyntaxError} si une ligne n'est pas un JSON valide
 */
export function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((raw, index) => ({ raw, index, record: JSON.parse(raw) }));
}

/**
 * Calcule le hash SHA-256 hexadecimal d'une chaine.
 *
 * @param text - contenu a hacher
 * @returns le hash en hexadecimal minuscule
 */
export function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Convertit un motif glob en expression reguliere ancree.
 *
 * Supporte `**` (traverse les segments), `*` (dans un segment) et `?`.
 *
 * @param glob - motif de chemin
 * @returns l'expression reguliere equivalente
 */
export function globToRegex(glob) {
  const escaped = glob
    .replaceAll(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**/", "\u0000")
    .replaceAll("**", "\u0001")
    .replaceAll("*", "[^/]*")
    .replaceAll("?", "[^/]")
    .replaceAll("\u0000", "(?:.*/)?")
    .replaceAll("\u0001", ".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Teste si un chemin correspond a au moins un motif de la liste.
 *
 * @param path - chemin de fichier relatif au depot
 * @param globs - motifs glob
 * @returns vrai si au moins un motif correspond
 */
export function matchAny(path, globs) {
  return globs.some((glob) => globToRegex(glob).test(path));
}

/**
 * Applique la politique de fichiers d'un role a un chemin constate.
 *
 * `allow` present : seul ce qui correspond est permis. `deny` present :
 * ce qui correspond est refuse. `allow` et `deny` presents : il faut
 * correspondre a `allow` sans correspondre a `deny`.
 *
 * @param path - chemin de fichier relatif au depot
 * @param policy - politique du role, ou absence de politique
 * @returns vrai si le chemin est permis pour ce role
 */
export function pathAllowed(path, policy) {
  if (policy == null) return true;
  if (policy.deny != null && matchAny(path, policy.deny)) return false;
  if (policy.allow != null) return matchAny(path, policy.allow);
  return true;
}

/**
 * Extrait le prefixe litteral d'un motif glob, jusqu'au premier joker.
 *
 * @param glob - motif de chemin
 * @returns le prefixe sans joker
 */
export function literalPrefix(glob) {
  const cut = glob.search(/[*?[]/);
  return cut === -1 ? glob : glob.slice(0, cut);
}

/**
 * Decide si deux motifs de reservation peuvent designer un meme fichier.
 *
 * Regle volontairement conservatrice : deux motifs se chevauchent si le
 * prefixe litteral de l'un commence par celui de l'autre. Elle peut
 * sur-bloquer, jamais sous-bloquer, ce qui est le bon defaut pour une
 * serialisation.
 *
 * @param a - premier motif
 * @param b - second motif
 * @returns vrai si un chevauchement est possible
 */
export function patternsMayOverlap(a, b) {
  const pa = literalPrefix(a);
  const pb = literalPrefix(b);
  return pa.startsWith(pb) || pb.startsWith(pa);
}

/**
 * Termine le processus avec un message d'erreur.
 *
 * @param message - message affiche sur stderr
 * @returns jamais
 */
export function fail(message) {
  console.error(message);
  process.exit(1);
}

/**
 * Resout le statut sudocode a refleter pour une phase du pipeline.
 *
 * Resolution : cle exacte, puis joker de familles bloquees, puis joker
 * global. Retourne null quand l'integration est desactivee ou que la
 * table ne couvre pas la phase.
 *
 * @param phase - phase courante du pipeline
 * @param sudocode - bloc sudocode de la configuration, ou absence
 * @returns le statut a ecrire, ou null pour ne rien refleter
 */
export function sudocodeStatus(phase, sudocode) {
  if (sudocode?.enabled !== true) return null;
  const map = sudocode.status_map ?? {};
  if (map[phase] != null) return map[phase];
  if (phase.startsWith("blocked_") && map["blocked_*"] != null) return map["blocked_*"];
  return map["*"] ?? null;
}
