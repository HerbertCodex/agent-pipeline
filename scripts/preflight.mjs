import { spawnSync } from "node:child_process";
import { loadConfig, fail } from "./lib.mjs";

/**
 * Motifs par lesquels un interpreteur annonce qu'un outil n'existe pas.
 *
 * La detection est heuristique et l'assume : il n'existe pas de code de
 * sortie universel pour « binaire absent ». Un faux negatif se traduit par
 * une porte classee refusante alors qu'elle est indisponible — c'est-a-dire
 * l'etat qu'on a aujourd'hui, jamais pire.
 */
const ABSENT =
  /command not found|not found|No such file or directory|is not recognized|ENOENT|Cannot find module|MODULE_NOT_FOUND|executable file not found/i;

/**
 * Classe le resultat d'une porte : disponible et verte, disponible et
 * refusante, ou indisponible.
 *
 * La distinction est le point : une porte qui echoue parce qu'elle a trouve
 * quelque chose et une porte qui echoue parce que son outil manque se
 * ressemblent dans un journal, et ne veulent pas du tout dire la meme chose.
 * Confondues, la seconde apprend a ignorer la premiere.
 *
 * @param key - cle de la porte dans `commands`
 * @param command - commande a executer
 * @returns le verdict, le code de sortie et la premiere ligne utile
 */
export function classify(key, command) {
  const result = spawnSync(command, { shell: true, encoding: "utf8", timeout: 600000 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const lines = output.split("\n").filter((line) => line.trim().length > 0);
  const telling = lines.find((line) => ABSENT.test(line)) ?? lines[0] ?? "";

  if (result.error?.code === "ETIMEDOUT") {
    return { key, verdict: "trop-longue", status: null, detail: "depasse dix minutes" };
  }
  if (result.status === 0) return { key, verdict: "verte", status: 0, detail: "" };
  if (result.status === 127 || ABSENT.test(output)) {
    return { key, verdict: "indisponible", status: result.status, detail: telling.trim().slice(0, 120) };
  }
  return { key, verdict: "refuse", status: result.status, detail: telling.trim().slice(0, 120) };
}

/**
 * Verifie que chaque porte declaree est reellement executable.
 *
 * Une porte dont l'outil manque echoue au lieu de proteger, et une porte qui
 * echoue toujours finit contournee : le depot affirme alors une protection
 * que personne n'exerce. Ce controle separe donc les deux cas avant qu'ils se
 * confondent dans un journal de CI.
 *
 * Usage : node preflight.mjs [--json]
 */
function main() {
  const json = process.argv.includes("--json");
  const config = loadConfig();
  const keys = Object.keys(config.commands ?? {});
  if (keys.length === 0) fail("aucune commande declaree dans commands");

  const results = keys.map((key) => classify(key, config.commands[key]));
  const missing = results.filter((item) => item.verdict === "indisponible");

  if (json) {
    console.log(JSON.stringify({ results, missing: missing.map((item) => item.key) }, null, 2));
  } else {
    for (const item of results) {
      const mark = { verte: "  ok   ", refuse: "  refuse", indisponible: "  ABSENT", "trop-longue": "  lente " }[item.verdict];
      console.log(`${mark} ${item.key.padEnd(16)} ${item.detail}`);
    }
    console.log("");
    if (missing.length === 0) {
      console.log("toutes les portes declarees sont executables.");
      console.log("Une porte rouge signale donc un constat, jamais un outil manquant.");
    } else {
      console.log(`${missing.length} porte(s) ne peuvent pas s'executer : ${missing.map((item) => item.key).join(", ")}`);
      console.log("Ces portes echouent au lieu de proteger. Le depot affirme une protection que personne n'exerce.");
      console.log("Installez l'outil, ou retirez la cle de commands — mais ne laissez pas une porte rouge en permanence.");
    }
  }

  if (missing.length > 0) process.exit(1);
}

if (process.argv[1]?.endsWith("preflight.mjs")) main();
