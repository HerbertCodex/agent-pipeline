import { readFileSync, writeFileSync } from "node:fs";
import { fail } from "./lib.mjs";
import { esc, shell, SURFACE_HINT, resolvePage, safeConfig } from "./page.mjs";

/**
 * Reads and validates the small, ORM-neutral format used for the diagram.
 *
 * The schema remains the technical source of truth. This file is the
 * deliberately explicit projection a human can review: parsing every SQL
 * dialect or ORM would give a false impression of coverage.
 */
function readModel(path) {
  let model;
  try {
    model = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`data model unreadable: ${error.message}`);
  }
  if (!Array.isArray(model.entities) || model.entities.length === 0) {
    fail("data model must carry a non-empty entities list");
  }
  const names = new Set();
  for (const entity of model.entities) {
    if (typeof entity?.name !== "string" || entity.name.trim().length === 0 || names.has(entity.name)) {
      fail("every data-model entity needs a unique name");
    }
    names.add(entity.name);
    if (!Array.isArray(entity.fields) || entity.fields.length === 0) {
      fail(`entity ${entity.name} needs a non-empty fields list`);
    }
    for (const field of entity.fields) {
      if (typeof field?.name !== "string" || typeof field?.type !== "string") {
        fail(`every field of ${entity.name} needs a name and type`);
      }
    }
  }
  for (const relation of model.relations ?? []) {
    if (!names.has(relation?.from?.entity) || !names.has(relation?.to?.entity)) {
      fail("every relation must name existing from and to entities");
    }
    if (typeof relation.from.field !== "string" || typeof relation.to.field !== "string") {
      fail("every relation endpoint must name its field");
    }
  }
  return model;
}

function fields(entity) {
  return entity.fields.map((field) => {
    const flags = [field.primary_key ? "PK" : "", field.unique ? "UQ" : "", field.nullable === false ? "NN" : ""]
      .filter(Boolean)
      .join(" · ");
    return `<li><code>${esc(field.name)}</code><span>${esc(field.type)}</span>${flags ? `<em>${flags}</em>` : ""}</li>`;
  }).join("");
}

function relationRows(model) {
  return (model.relations ?? []).map((relation) => {
    const label = relation.label ? ` — ${esc(relation.label)}` : "";
    return `<li><code>${esc(relation.from.entity)}.${esc(relation.from.field)}</code><span>→</span>` +
      `<code>${esc(relation.to.entity)}.${esc(relation.to.field)}</code><em>${esc(relation.cardinality ?? "")}</em>${label}</li>`;
  }).join("");
}

/** Renders a self-contained UML-style class diagram. */
function main() {
  const [source, target] = process.argv.slice(2);
  if (!source || !target) fail("usage: render-data-model.mjs <diagram.json> <output.html>");
  const model = readModel(source);
  const index = new Map(model.entities.map((entity, position) => [entity.name, position]));
  const links = (model.relations ?? []).map((relation) => ({
    from: index.get(relation.from.entity), to: index.get(relation.to.entity), cardinality: relation.cardinality ?? "",
  }));
  const cards = model.entities.map((entity, position) => `<article class="uml-entity" data-entity="${position}">
<header><span>${esc(entity.stereotype ?? "table")}</span><h3>${esc(entity.name)}</h3></header>
<ul>${fields(entity)}</ul></article>`).join("");
  const title = model.title ?? "Relational data model";
  const script = JSON.stringify(links).replaceAll("<", "\\u003c");
  const body = `<header class="masthead"><p class="eyebrow">Data model · UML projection</p>
<h1>${esc(title)}</h1><p class="lede">Tables, keys and relations derived from the declared model. The physical schema remains the source of truth.</p>
<p class="verbatim">Lines point from the foreign-key side to the referenced side. PK = primary key, UQ = unique, NN = not null.</p></header>
<section><div class="sec-head"><h2>Entity diagram</h2><p>${model.entities.length} table(s) · ${(model.relations ?? []).length} relation(s)</p></div>
<div class="uml-canvas"><svg class="uml-links" aria-hidden="true"><defs><marker id="uml-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z"/></marker></defs></svg>
<div class="uml-grid">${cards}</div></div></section>
${(model.relations ?? []).length ? `<section><div class="sec-head"><h2>Relations</h2><p>Declared foreign-key directions and cardinalities.</p></div><ul class="uml-relations">${relationRows(model)}</ul></section>` : ""}
<style>
.uml-canvas{position:relative;overflow:auto;padding:1rem;background:var(--stamp-wash);border:1px solid var(--rule);border-radius:3px}.uml-grid{position:relative;display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:1.25rem;min-width:34rem}.uml-entity{z-index:1;background:var(--card);border:1px solid var(--ink);border-radius:3px;box-shadow:var(--shadow);overflow:hidden}.uml-entity header{padding:.7rem .9rem;border-bottom:1px solid var(--rule);display:flex;align-items:baseline;gap:.65rem}.uml-entity header span{font:600 .62rem var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--stamp)}.uml-entity h3{margin:0;font:600 1.05rem var(--mono)}.uml-entity ul{margin:0;padding:.45rem 0;list-style:none}.uml-entity li{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:.6rem;padding:.23rem .9rem;font:.78rem var(--mono)}.uml-entity li span{color:var(--muted)}.uml-entity li em{font:600 .6rem var(--sans);color:var(--stamp);font-style:normal}.uml-links{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;overflow:visible}.uml-links line{stroke:var(--stamp);stroke-width:1.5;marker-end:url(#uml-arrow)}.uml-links text{font:600 .65rem var(--sans);fill:var(--stamp)}.uml-relations{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:.55rem}.uml-relations li{display:flex;flex-wrap:wrap;gap:.55rem;align-items:baseline;padding:.7rem .9rem;background:var(--card);border:1px solid var(--rule);border-radius:3px;font:.82rem var(--sans)}.uml-relations li span{color:var(--stamp);font-weight:700}.uml-relations em{color:var(--muted);font-style:normal}@media(max-width:640px){.uml-grid{min-width:28rem}}
</style>
<script>
const links=${script};const canvas=document.querySelector('.uml-canvas'),svg=document.querySelector('.uml-links');
function draw(){
  const base=canvas.getBoundingClientRect();svg.replaceChildren(svg.querySelector('defs'));
  for(const link of links){
    const a=document.querySelector("[data-entity='"+link.from+"']");
    const b=document.querySelector("[data-entity='"+link.to+"']");
    if(!a||!b)continue;
    const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();
    const x1=ar.left+ar.width/2-base.left+canvas.scrollLeft,y1=ar.top+ar.height/2-base.top+canvas.scrollTop;
    const x2=br.left+br.width/2-base.left+canvas.scrollLeft,y2=br.top+br.height/2-base.top+canvas.scrollTop;
    const line=document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1',x1);line.setAttribute('y1',y1);line.setAttribute('x2',x2);line.setAttribute('y2',y2);svg.append(line);
    if(link.cardinality){const text=document.createElementNS('http://www.w3.org/2000/svg','text');text.textContent=link.cardinality;text.setAttribute('x',(x1+x2)/2);text.setAttribute('y',(y1+y2)/2-5);svg.append(text)}
  }
}
addEventListener('resize',draw);addEventListener('load',draw);draw();
</script>`;
  const config = safeConfig();
  const written = resolvePage(target, config);
  writeFileSync(written, shell(title, body));
  console.log(`written: ${written} (${model.entities.length} entity(ies), ${(model.relations ?? []).length} relation(s))`);
  console.log(SURFACE_HINT);
}

if (process.argv[1]?.endsWith("render-data-model.mjs")) main();
