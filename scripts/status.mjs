import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, loadRules, readJsonl } from "./lib.mjs";

const PHASE_ORDER = [
  "planned",
  "tests_in_progress",
  "tests_red",
  "implementation_in_progress",
  "ready_for_qa",
  "qa_in_progress",
  "closed",
];
const BLOCKED_PREFIX = "blocked_";

/**
 * Regroupe les issues du store par colonne d'affichage.
 *
 * Les phases bloquees et l'escalade forment deux colonnes dediees pour
 * rester visibles quel que soit leur nombre.
 *
 * @param entries - entrees du store issues.jsonl
 * @returns les colonnes ordonnees avec leurs issues
 */
function groupByColumn(entries) {
  const columns = new Map(PHASE_ORDER.map((phase) => [phase, []]));
  columns.set("blocked", []);
  columns.set("operator_escalation", []);
  for (const entry of entries) {
    const phase = entry.record.pipeline_state?.phase ?? "planned";
    const key = phase.startsWith(BLOCKED_PREFIX) ? "blocked" : phase;
    (columns.get(key) ?? columns.get("planned")).push(entry.record);
  }
  return columns;
}

/**
 * Construit la ligne de resume d'une issue pour la vue CLI.
 *
 * @param record - record d'issue
 * @returns la ligne formatee
 */
function cliLine(record) {
  const state = record.pipeline_state ?? {};
  const sha = state.last_commit_sha ? state.last_commit_sha.slice(0, 7) : "-";
  const rejections = state.qa_code_rejections > 0 ? ` rejets:${state.qa_code_rejections}` : "";
  const blocked = state.phase?.startsWith(BLOCKED_PREFIX) ? ` [${state.phase}]` : "";
  return `  ${record.id} v${state.version ?? "?"} ${sha}${rejections}${blocked} ${record.title ?? ""}`;
}

/**
 * Echappe le contenu injecte dans la page HTML.
 *
 * @param text - texte brut issu du store
 * @returns le texte sur pour un noeud HTML
 */
function esc(text) {
  return String(text ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/**
 * Rend la page HTML autonome du tableau de bord.
 *
 * @param columns - issues groupees par colonne
 * @param specs - records de specs
 * @param profile - nom du profil actif
 * @returns le document HTML complet
 */
function renderHtml(columns, specs, profile) {
  const labels = {
    planned: "Planned",
    tests_in_progress: "Tests en cours",
    tests_red: "Tests rouges",
    implementation_in_progress: "Implementation",
    ready_for_qa: "Pret pour QA",
    qa_in_progress: "QA en cours",
    closed: "Closed",
    blocked: "Bloquees",
    operator_escalation: "Escalade",
  };
  const cards = (records) =>
    records
      .map((record) => {
        const state = record.pipeline_state ?? {};
        const sha = state.last_commit_sha ? state.last_commit_sha.slice(0, 7) : "";
        const badges = [
          state.qa_code_rejections > 0 ? `<span class="badge warn">rejets ${state.qa_code_rejections}</span>` : "",
          sha ? `<span class="badge">${esc(sha)}</span>` : "",
          state.phase?.startsWith(BLOCKED_PREFIX) ? `<span class="badge block">${esc(state.phase)}</span>` : "",
        ].join("");
        const reservations = (state.file_reservations ?? []).map((r) => `<code>${esc(r)}</code>`).join(" ");
        const contexts = (record.contexts ?? [])
          .map((c) => `<details><summary>${esc(c.heading)} <time>${esc(c.at ?? "")}</time></summary><pre>${esc(c.body)}</pre></details>`)
          .join("");
        return `<article><header><strong>${esc(record.id)}</strong> <span class="v">v${esc(state.version)}</span>${badges}</header><h3>${esc(record.title)}</h3><p class="res">${reservations}</p>${contexts}</article>`;
      })
      .join("");
  const columnsHtml = [...columns.entries()]
    .map(([key, records]) => `<section class="col ${key === "blocked" || key === "operator_escalation" ? "alert" : ""}"><h2>${labels[key]} <span class="count">${records.length}</span></h2>${cards(records)}</section>`)
    .join("");
  const specsHtml = specs
    .map((s) => `<li><strong>${esc(s.record.id)}</strong> ${esc(s.record.title ?? "")} <span class="badge">${esc(s.record.status ?? "draft")}</span></li>`)
    .join("");
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta http-equiv="refresh" content="15">
<title>Pipeline ${esc(profile)}</title>
<style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif}
body{margin:1rem;background:Canvas;color:CanvasText}
h1{font-size:1.1rem}h1 small{font-weight:normal;opacity:.6}
.board{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(220px,1fr);gap:.6rem;overflow-x:auto;align-items:start}
.col{background:color-mix(in srgb,CanvasText 6%,Canvas);border-radius:8px;padding:.5rem;min-height:4rem}
.col.alert{outline:2px solid color-mix(in srgb,red 55%,Canvas)}
.col h2{font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;margin:.2rem .2rem .6rem}
.count{opacity:.55}
article{background:Canvas;border:1px solid color-mix(in srgb,CanvasText 15%,Canvas);border-radius:6px;padding:.5rem;margin-bottom:.5rem}
article h3{font-size:.85rem;margin:.3rem 0}
header{display:flex;gap:.35rem;align-items:center;flex-wrap:wrap}
.v{opacity:.55;font-size:.75rem}
.badge{font-size:.68rem;border:1px solid color-mix(in srgb,CanvasText 25%,Canvas);border-radius:99px;padding:.05rem .45rem}
.badge.warn{border-color:orange}.badge.block{border-color:red}
.res code{font-size:.68rem;opacity:.75}
details{font-size:.75rem;margin-top:.3rem}summary{cursor:pointer}
pre{white-space:pre-wrap;background:color-mix(in srgb,CanvasText 6%,Canvas);padding:.4rem;border-radius:4px}
time{opacity:.5;font-size:.65rem}
ul.specs{list-style:none;padding:0;display:flex;gap:1rem;flex-wrap:wrap}
</style></head><body>
<h1>Pipeline <small>profil ${esc(profile)}, genere ${esc(new Date().toISOString())}, rafraichi toutes les 15 s</small></h1>
<ul class="specs">${specsHtml || "<li>aucune spec</li>"}</ul>
<div class="board">${columnsHtml}</div>
</body></html>`;
}

/**
 * Affiche l'etat du pipeline sur la sortie standard et, avec --html,
 * ecrit une page autonome dans le repertoire du store.
 *
 * Usage : node status.mjs [--html]
 */
function main() {
  const config = loadConfig();
  loadRules();
  const issues = readJsonl(join(config.store_dir, "issues.jsonl"));
  const specs = readJsonl(join(config.store_dir, "specs.jsonl"));
  const columns = groupByColumn(issues);

  if (issues.length === 0) {
    console.log(`store vide : aucune issue dans ${config.store_dir}/ (il se remplit a la premiere persistance de l'orchestrateur)`);
  }
  for (const [key, records] of columns) {
    if (records.length === 0) continue;
    console.log(`${key} (${records.length})`);
    for (const record of records) console.log(cliLine(record));
  }
  const escalated = columns.get("operator_escalation").length;
  const blocked = columns.get("blocked").length;
  if (escalated + blocked > 0) console.log(`ATTENTION : ${blocked} bloquee(s), ${escalated} escalade(s)`);

  if (process.argv.includes("--html")) {
    mkdirSync(config.store_dir, { recursive: true });
    const outPath = join(config.store_dir, "status.html");
    writeFileSync(outPath, renderHtml(columns, specs, config.profile));
    console.log(`ecrit : ${outPath}`);
  }
}

main();
