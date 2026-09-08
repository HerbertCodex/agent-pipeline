import { readFileSync, writeFileSync } from "node:fs";
import { fail } from "./lib.mjs";
import { esc, shell, SURFACE_HINT, resolvePage, safeConfig } from "./page.mjs";
import { validateDataModelContract } from "./data-model-contract.mjs";

/** Reads the legacy diagram or validates and projects a governance v2 contract. */
function readModel(path) {
  let model;
  try { model = JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { fail(`data model unreadable: ${error.message}`); }
  if (model.version === 1 && model.database?.kind === "relational") {
    try { validateDataModelContract(model, { root: process.cwd() }); }
    catch (error) { fail(`data model contract invalid: ${error.message}`); }
    return {
      ...model,
      entities: model.entities.map((entity) => ({
        ...entity,
        fields: entity.fields.map((field) => ({ ...field, primary_key: entity.primary_key.includes(field.name), unique: (entity.candidate_keys ?? []).some((key) => key.length === 1 && key[0] === field.name) })),
      })),
      relations: (model.relations ?? []).map((relation) => ({ ...relation, from: { entity: relation.from.entity, field: relation.from.fields.join(" + ") }, to: { entity: relation.to.entity, field: relation.to.fields.join(" + ") } })),
    };
  }
  if (!Array.isArray(model.entities) || model.entities.length === 0) fail("data model must carry a non-empty entities list");
  const names = new Set();
  const fieldsByEntity = new Map();
  for (const entity of model.entities) {
    if (typeof entity?.name !== "string" || entity.name.trim().length === 0 || names.has(entity.name)) fail("every data-model entity needs a unique name");
    names.add(entity.name);
    if (!Array.isArray(entity.fields) || entity.fields.length === 0) fail(`entity ${entity.name} needs a non-empty fields list`);
    for (const field of entity.fields) if (typeof field?.name !== "string" || typeof field?.type !== "string") fail(`every field of ${entity.name} needs a name and type`);
    fieldsByEntity.set(entity.name, new Set(entity.fields.map((field) => field.name)));
  }
  for (const relation of model.relations ?? []) {
    if (!names.has(relation?.from?.entity) || !names.has(relation?.to?.entity)) fail("every relation must name existing from and to entities");
    if (typeof relation.from.field !== "string" || typeof relation.to.field !== "string") fail("every relation endpoint must name its field");
    if (!fieldsByEntity.get(relation.from.entity).has(relation.from.field) || !fieldsByEntity.get(relation.to.entity).has(relation.to.field)) fail("every relation endpoint must name an existing field");
  }
  return model;
}

function fieldRows(entity) {
  return entity.fields.map((field) => {
    const flags = [field.primary_key ? "PK" : "", field.unique ? "UQ" : "", field.nullable === false ? "NN" : "", field.classification ?? ""].filter(Boolean).join(" · ");
    return `<li><code>${esc(field.name)}</code><span>${esc(field.type)}</span>${flags ? `<em>${esc(flags)}</em>` : ""}</li>`;
  }).join("");
}

function relationRows(model) {
  return (model.relations ?? []).map((relation) => {
    const label = relation.label ? ` — ${esc(relation.label)}` : "";
    const behavior = relation.on_delete ? ` · delete ${esc(relation.on_delete)} · update ${esc(relation.on_update)}` : "";
    return `<li><code>${esc(relation.from.entity)}.${esc(relation.from.field)}</code><span>→</span><code>${esc(relation.to.entity)}.${esc(relation.to.field)}</code><em>${esc(relation.cardinality ?? "")}${behavior}</em>${label}</li>`;
  }).join("");
}

function governance(model) {
  if (model.version !== 1 || model.database?.kind !== "relational") return "";
  const accesses = model.access_patterns.map((access) => `<li><code>${esc(access.id)}</code><span>${esc(access.entity)}</span><span>filters: ${esc(access.filters.join(", ") || "none")}</span><span>${esc(access.pagination)} · ${esc(access.budget_ms)} ms · ${esc(access.representative_rows)} rows</span></li>`).join("");
  const denormalizations = (model.denormalizations ?? []).map((item) => `<li><code>${esc(item.entity)}.${esc(item.fields.join(" + "))}</code><span>${esc(item.reason)}</span><span>${esc(item.benchmark.before_ms)} → ${esc(item.benchmark.after_ms)} ms</span></li>`).join("");
  return `<section><div class="sec-head"><h2>Governance</h2><p>${esc(model.database.workload.toUpperCase())} · target ${esc(model.policy.normalization.target)}</p></div><div class="governance-grid"><article><h3>Audit</h3><p>Append-only ${esc(model.policy.audit.entity)} · UTC · secrets excluded</p></article><article><h3>Security</h3><p>Deny by default · TLS required · private network · ${esc(model.policy.security.statement_timeout_ms)} ms timeout</p></article><article><h3>Migrations</h3><p>Expand-contract · lock budget ${esc(model.policy.migrations.lock_budget_ms)} ms</p></article><article><h3>Recovery</h3><p>Encrypted backups · isolated restore · RPO ${esc(model.policy.recovery.recovery_point_objective_minutes)} min</p></article></div></section><section><div class="sec-head"><h2>Access patterns</h2><p>Indexes and measured query budgets.</p></div><ul class="governance-list">${accesses}</ul></section>${denormalizations ? `<section><div class="sec-head"><h2>Measured denormalizations</h2><p>Reviewed exceptions to the normal form.</p></div><ul class="governance-list">${denormalizations}</ul></section>` : ""}`;
}

/** Renders a self-contained UML and governance review page. */
function main() {
  const [source, target] = process.argv.slice(2);
  if (!source || !target) fail("usage: render-data-model.mjs <diagram-or-contract.json> <output.html>");
  const model = readModel(source);
  const index = new Map(model.entities.map((entity, position) => [entity.name, position]));
  const links = (model.relations ?? []).map((relation) => ({ from: index.get(relation.from.entity), to: index.get(relation.to.entity), cardinality: relation.cardinality ?? "" }));
  const cards = model.entities.map((entity, position) => `<article class="uml-entity" data-entity="${position}"><header><span>${esc(entity.stereotype ?? "table")}${entity.normalization?.normal_form ? ` · ${esc(entity.normalization.normal_form)}` : ""}</span><h3>${esc(entity.name)}</h3></header><ul>${fieldRows(entity)}</ul></article>`).join("");
  const title = model.title ?? "Relational data model";
  const script = JSON.stringify(links).replaceAll("<", "\\u003c");
  const body = `<header class="masthead"><p class="eyebrow">Data model · UML projection</p><h1>${esc(title)}</h1><p class="lede">Tables, keys, ownership and relations from the reviewed contract. The physical schema remains the source of truth.</p><p class="verbatim">Lines point from foreign keys to referenced keys. PK = primary key, UQ = unique, NN = not null.</p></header><section><div class="sec-head"><h2>Entity diagram</h2><p>${model.entities.length} table(s) · ${(model.relations ?? []).length} relation(s)</p></div><div class="uml-canvas"><svg class="uml-links" aria-hidden="true"><defs><marker id="uml-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z"/></marker></defs></svg><div class="uml-grid">${cards}</div></div></section>${(model.relations ?? []).length ? `<section><div class="sec-head"><h2>Relations</h2><p>Foreign-key directions, cardinalities and lifecycle behavior.</p></div><ul class="uml-relations">${relationRows(model)}</ul></section>` : ""}${governance(model)}
<style>.uml-canvas{position:relative;overflow:auto;padding:1rem;background:var(--stamp-wash);border:1px solid var(--rule);border-radius:3px}.uml-grid{position:relative;display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:1.25rem;min-width:34rem}.uml-entity{z-index:1;background:var(--card);border:1px solid var(--ink);border-radius:3px;box-shadow:var(--shadow);overflow:hidden}.uml-entity header{padding:.7rem .9rem;border-bottom:1px solid var(--rule);display:flex;align-items:baseline;gap:.65rem}.uml-entity header span{font:600 .62rem var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--stamp)}.uml-entity h3{margin:0;font:600 1.05rem var(--mono)}.uml-entity ul{margin:0;padding:.45rem 0;list-style:none}.uml-entity li{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:.6rem;padding:.23rem .9rem;font:.78rem var(--mono)}.uml-entity li span{color:var(--muted)}.uml-entity li em{font:600 .6rem var(--sans);color:var(--stamp);font-style:normal}.uml-links{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0}.uml-links line{stroke:var(--stamp);stroke-width:1.5;marker-end:url(#uml-arrow)}.uml-links text{font:600 .65rem var(--sans);fill:var(--stamp)}.uml-relations,.governance-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:.55rem}.uml-relations li,.governance-list li{display:flex;flex-wrap:wrap;gap:.55rem;align-items:baseline;padding:.7rem .9rem;background:var(--card);border:1px solid var(--rule);border-radius:3px;font:.82rem var(--sans)}.uml-relations li span{color:var(--stamp);font-weight:700}.uml-relations em{color:var(--muted);font-style:normal}.governance-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(13rem,1fr));gap:.8rem}.governance-grid article{padding:.8rem;background:var(--card);border:1px solid var(--rule)}.governance-grid h3{margin:0 0 .35rem;font:600 .82rem var(--sans)}.governance-grid p{margin:0;color:var(--muted);font:.76rem var(--mono)}.governance-list li span:last-child{margin-left:auto;color:var(--muted)}@media(max-width:640px){.uml-grid{min-width:28rem}}</style>
<script>const links=${script};const canvas=document.querySelector('.uml-canvas'),svg=document.querySelector('.uml-links');function draw(){const base=canvas.getBoundingClientRect();svg.replaceChildren(svg.querySelector('defs'));for(const link of links){const a=document.querySelector("[data-entity='"+link.from+"']"),b=document.querySelector("[data-entity='"+link.to+"']");if(!a||!b)continue;const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect(),x1=ar.left+ar.width/2-base.left+canvas.scrollLeft,y1=ar.top+ar.height/2-base.top+canvas.scrollTop,x2=br.left+br.width/2-base.left+canvas.scrollLeft,y2=br.top+br.height/2-base.top+canvas.scrollTop;const line=document.createElementNS('http://www.w3.org/2000/svg','line');for(const [key,value] of Object.entries({x1,y1,x2,y2}))line.setAttribute(key,value);svg.append(line);if(link.cardinality){const text=document.createElementNS('http://www.w3.org/2000/svg','text');text.textContent=link.cardinality;text.setAttribute('x',(x1+x2)/2);text.setAttribute('y',(y1+y2)/2-5);svg.append(text)}}}addEventListener('resize',draw);addEventListener('load',draw);draw();</script>`;
  const written = resolvePage(target, safeConfig());
  writeFileSync(written, shell(title, body));
  console.log(`written: ${written} (${model.entities.length} entity(ies), ${(model.relations ?? []).length} relation(s))`);
  console.log(SURFACE_HINT);
}

if (process.argv[1]?.endsWith("render-data-model.mjs")) main();
