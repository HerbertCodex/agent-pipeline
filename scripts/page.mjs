import { mkdirSync } from "node:fs";
import { fail } from "./lib.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync, readdirSync } from "node:fs";
/**
 * Stylesheet shared by the pipeline's review pages.
 *
 * One definition for every page: two copies would diverge on the first tweak,
 * and the operator would read two different products depending on which page
 * was open. Colours go through tokens redefined for the three theme states a
 * reader can be in: an explicit light choice, an explicit dark choice, and
 * the system setting that stamps neither.
 */
const STYLE = `
:root{--paper:#f4f3f7;--card:#fff;--ink:#1b1f2a;--muted:#5c5a68;--faint:#86838f;--rule:#dedbe6;
--stamp:#5b3fa8;--stamp-wash:#ece8f6;--exclude:#8d8896;--exclude-wash:#eceaf0;--alarm:#a3364a;
--alarm-wash:#f7e9ec;--shadow:0 1px 2px rgba(27,31,42,.05),0 8px 24px -12px rgba(27,31,42,.12);
--serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Times New Roman",serif;
--sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
--mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--paper:#15141b;--card:#1c1b24;--ink:#e9e7f0;
--muted:#a09dae;--faint:#7b7889;--rule:#2f2c3a;--stamp:#ab94ee;--stamp-wash:#241f36;--exclude:#8a8697;
--exclude-wash:#201f28;--alarm:#f0899c;--alarm-wash:#2c1a20;
--shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px -12px rgba(0,0,0,.6)}}
:root[data-theme="dark"]{--paper:#15141b;--card:#1c1b24;--ink:#e9e7f0;--muted:#a09dae;--faint:#7b7889;
--rule:#2f2c3a;--stamp:#ab94ee;--stamp-wash:#241f36;--exclude:#8a8697;--exclude-wash:#201f28;
--alarm:#f0899c;--alarm-wash:#2c1a20;--shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px -12px rgba(0,0,0,.6)}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--serif);font-size:17px;
line-height:1.62;-webkit-font-smoothing:antialiased}
.wrap{max-width:62rem;margin:0 auto;padding:3rem 1.5rem 6rem;display:flex;flex-direction:column;gap:3.5rem}
.masthead{display:flex;flex-direction:column;gap:1.25rem}
.eyebrow{font-family:var(--sans);font-size:.7rem;font-weight:600;letter-spacing:.13em;text-transform:uppercase;color:var(--stamp);margin:0}
h1{font-size:clamp(2rem,5vw,3rem);line-height:1.1;font-weight:600;letter-spacing:-.02em;text-wrap:balance;margin:0}
.lede{font-size:1.2rem;line-height:1.55;color:var(--muted);max-width:42rem;margin:0}
.stamp{display:flex;flex-wrap:wrap;gap:.5rem 2rem;padding:1rem 1.25rem;background:var(--stamp-wash);
border:1px solid var(--rule);border-radius:3px;font-family:var(--sans);font-size:.82rem}
.stamp div{display:flex;flex-direction:column;gap:.15rem}
.stamp dt{color:var(--muted);font-size:.68rem;letter-spacing:.1em;text-transform:uppercase}
.stamp dd{margin:0;font-weight:600;font-variant-numeric:tabular-nums}
.stamp .digest{font-family:var(--mono);font-size:.72rem;font-weight:400;word-break:break-all}
.verbatim{font-family:var(--sans);font-size:.84rem;line-height:1.55;color:var(--muted);
border-left:2px solid var(--stamp);padding-left:1rem;margin:0;max-width:44rem}
section{display:flex;flex-direction:column;gap:1.75rem}
.sec-head{display:flex;flex-direction:column;gap:.4rem;border-top:2px solid var(--ink);padding-top:.9rem}
.sec-head h2{font-size:1.6rem;font-weight:600;letter-spacing:-.015em;margin:0;text-wrap:balance}
.sec-head p{margin:0;color:var(--muted);font-family:var(--sans);font-size:.88rem}
.features{display:flex;flex-direction:column;gap:1.5rem}
.feature{background:var(--card);border:1px solid var(--rule);border-radius:3px;box-shadow:var(--shadow);
padding:1.5rem 1.6rem;display:flex;flex-direction:column;gap:1rem}
.feature>header{display:flex;gap:.9rem;align-items:baseline}
.num{font-family:var(--mono);font-size:.78rem;font-weight:600;color:var(--stamp);
font-variant-numeric:tabular-nums;padding-top:.25rem;flex:none}
.feature h3{font-size:1.28rem;font-weight:600;letter-spacing:-.012em;margin:0;text-wrap:balance}
.value{margin:0 0 0 2.3rem;color:var(--muted);font-style:italic;max-width:46rem}
ol.rules,ol.excl,ol.pledges{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
ol.rules{gap:.7rem}ol.pledges{gap:.9rem}ol.excl{gap:.55rem}
ol.rules li,ol.pledges li{display:flex;gap:.9rem;align-items:baseline}
.rid{font-family:var(--mono);font-size:.7rem;color:var(--faint);font-variant-numeric:tabular-nums;
flex:none;width:2.1rem;padding-top:.18rem}
ol.pledges .rid{color:var(--stamp);width:1.6rem}
ol.rules p,ol.pledges p{margin:0;max-width:47rem}
ol.pledges p{font-size:.96rem}
ol.excl li{display:flex;gap:.9rem;align-items:baseline;background:var(--exclude-wash);
border-left:2px solid var(--exclude);padding:.7rem .95rem;border-radius:0 3px 3px 0}
ol.excl .rid{color:var(--exclude);width:1.6rem}
ol.excl p{margin:0;font-size:.95rem;max-width:48rem}
.open{background:var(--card);border:1px solid var(--stamp);border-radius:3px;box-shadow:var(--shadow);
padding:1.4rem 1.5rem;display:flex;flex-direction:column;gap:.85rem}
.open.urgent{border-color:var(--alarm)}
.open h3{font-size:1.1rem;font-weight:600;margin:0;display:flex;gap:.7rem;align-items:baseline;text-wrap:balance}
.open h3 .qid{font-family:var(--mono);font-size:.78rem;color:var(--stamp);flex:none}
.open.urgent h3 .qid{color:var(--alarm)}
.open p{margin:0;max-width:47rem}
.open .reco{font-size:.96rem;border-left:2px solid var(--stamp);padding-left:.9rem;color:var(--ink)}
.open.urgent .reco{border-color:var(--alarm)}
.open .alts{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:.4rem}
.open .alts li{display:flex;gap:.7rem;align-items:baseline;font-size:.92rem;color:var(--muted)}
.open .alts li::before{content:"·";color:var(--stamp);font-weight:700;flex:none}
.lbl{font-family:var(--sans);font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.chip{font-family:var(--sans);font-size:.68rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
padding:.2rem .5rem;border-radius:2px;background:var(--stamp-wash);color:var(--stamp);flex:none}
.chip.alarm{background:var(--alarm-wash);color:var(--alarm)}
.paths{font-family:var(--mono);font-size:.78rem;color:var(--muted);display:flex;flex-wrap:wrap;gap:.35rem .8rem;margin:0}
.waves{display:flex;flex-direction:column;gap:.6rem}
.wave{display:flex;gap:.9rem;align-items:baseline;padding:.8rem .95rem;border:1px solid var(--rule);
border-radius:3px;background:var(--card)}
.wave .rid{color:var(--stamp);width:1.6rem}
.wave p{margin:0;font-size:.96rem}
.note{font-family:var(--sans);font-size:.88rem;line-height:1.6;color:var(--muted);background:var(--stamp-wash);
border:1px solid var(--rule);border-radius:3px;padding:1.1rem 1.25rem;margin:0;max-width:48rem}
.note strong{color:var(--ink)}
.empty{font-family:var(--sans);font-size:.92rem;color:var(--muted);margin:0}
.grow{font-size:.96rem;margin:0;color:var(--ink)}
.cost-move{font-family:var(--sans);font-size:.85rem;color:var(--muted);margin:0;padding:.6rem .8rem;background:var(--exclude-wash);border-radius:3px}
.cost-move strong{color:var(--ink)}
.open.muted{border-color:var(--rule);opacity:.82}
.reveals{font-family:var(--sans);font-size:.8rem;color:var(--faint);margin:0;font-style:italic}
.plain{font-size:1.08rem;line-height:1.55;margin:0;color:var(--ink)}
.short{font-family:var(--sans);font-size:.9rem;font-weight:600;color:var(--stamp);margin:0}
.split{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem}
@media (max-width:720px){.split{grid-template-columns:1fr}}
pre.tree{font-family:var(--mono);font-size:.76rem;line-height:1.6;background:var(--stamp-wash);
border:1px solid var(--rule);border-radius:3px;padding:.9rem 1rem;margin:0;overflow-x:auto}
.chain{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem;margin:0}
.box{font-family:var(--sans);font-size:.78rem;font-weight:600;padding:.35rem .65rem;border-radius:3px;
background:var(--card);border:1px solid var(--rule);color:var(--muted)}
.box.core{background:var(--stamp);border-color:var(--stamp);color:var(--paper)}
.arrow{color:var(--stamp);font-weight:700}
.chain-legend{font-family:var(--sans);font-size:.8rem;color:var(--muted);margin:.6rem 0 0}
ul.files{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:.35rem .5rem}
ul.files li{font-family:var(--mono);font-size:.74rem;background:var(--exclude-wash);border:1px solid var(--rule);
border-radius:2px;padding:.2rem .45rem;color:var(--muted)}
.tablewrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-family:var(--sans);font-size:.9rem}
th{text-align:left;font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);
padding:.6rem .8rem;border-bottom:2px solid var(--ink)}
td{padding:.75rem .8rem;border-bottom:1px solid var(--rule);vertical-align:top}
td:nth-child(2){font-variant-numeric:tabular-nums;font-weight:600;color:var(--stamp);text-align:center;width:6rem}
pre.decl{font-family:var(--mono);font-size:.76rem;line-height:1.5;background:var(--stamp-wash);border:1px solid var(--rule);border-radius:3px;padding:.9rem 1rem;margin:0;overflow-x:auto}
code{font-family:var(--mono);font-size:.86em;background:var(--stamp-wash);padding:.1em .35em;border-radius:2px}
:focus-visible{outline:2px solid var(--stamp);outline-offset:2px}
@media (max-width:640px){body{font-size:16px}.value{margin-left:0}.feature{padding:1.2rem 1.1rem}}
`;

/**
 * Escapes text from the store or a handoff for insertion into HTML.
 *
 * The content comes from an agent: it is treated as data and never as markup,
 * otherwise a spec could inject script into the very page the operator reads
 * to decide.
 *
 * @param value - text to escape, coerced to a string if needed
 * @returns the text with no character active for the HTML parser
 */
export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Renders an ordinal number on two digits.
 *
 * @param index - rank starting at zero
 * @returns the displayable rank, starting at one
 */
export function pad(index) {
  return String(index + 1).padStart(2, "0");
}

/**
 * Assembles a self-contained page around an already rendered body.
 *
 * @param title - title of the tab and of the gallery
 * @param body - HTML fragment of the content
 * @returns the complete page, with no external resource to load
 */
export function shell(title, body) {
  return `<title>${esc(title)}</title>\n<style>${STYLE}</style>\n<div class="wrap">\n${body}\n</div>\n`;
}

/**
 * What a capable harness should do with the page produced.
 *
 * The framework writes a file and stops there: it assumes neither that a
 * harness can host a page, nor that a browser exists, nor that a link can be
 * handed to the operator. Those capabilities belong to the tool running the
 * agents, not to the pipeline, and a framework assuming them would only run
 * on the one it was written for.
 *
 * The line is therefore printed where the driver already looks, in the
 * command's output, rather than buried in a document it may not have read.
 */
export const SURFACE_HINT =
  "to publish: if the harness can host an HTML page, publish it and hand the operator the link; otherwise hand them this path. The file opens on its own, with no network and no dependency.";

/**
 * Resolves where a rendered page is written.
 *
 * The renderers used to write wherever the operator happened to stand, and
 * the README's own examples wrote to the project root. Over a project's life
 * that leaves a pile of untracked HTML files next to the source, and nothing
 * ever said where they belonged.
 *
 * A bare name now lands in `pages_dir`. A name carrying a directory is taken
 * as given: asking for a path is asking for that path. A project that
 * declares no `pages_dir` keeps the previous behaviour, because moving the
 * pages of a repository that already runs the pipeline would be a change
 * nobody asked for.
 *
 * The parent directory is created, and the caller prints the resolved path —
 * a file that moves without saying so is a file the reader looks for in the
 * wrong place.
 *
 * @param target - the path or name the caller was given
 * @param config - the project configuration
 * @returns the path to write, its parent created
 */
export function resolvePage(target, config) {
  const named = target.includes("/") || target.includes("\\");
  const resolved = named || typeof config?.pages_dir !== "string" ? target : join(config.pages_dir, target);
  mkdirSync(dirname(resolved), { recursive: true });
  return resolved;
}

/**
 * Loads the configuration when there is one, and shrugs when there is not.
 *
 * `render-architecture` exists to be run before any configuration exists —
 * it is what produces the decision the configuration then records. It must
 * therefore ask where to write without depending on the answer.
 *
 * @param path - configuration file to read
 * @returns the configuration, or null outside a configured project
 */
export function safeConfig(path = "pipeline.config.json") {
  // `loadConfig` reports through `fail`, which exits the process: a caller
  // cannot catch it. Reading the file directly is what makes "absent" an
  // answer rather than a stop, and the first version of this helper wrapped
  // `loadConfig` in a try/catch that could never fire.
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Languages the framework ships pages in.
 */
const PAGES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "pages");

/**
 * Loads the text of the pages in the project's language.
 *
 * The pages are read by a person, and a person has a language. Everything
 * else here is written in English because models follow it more reliably;
 * these are the exception, for the same reason the README is.
 *
 * English is the fallback rather than a guess: a repository meant to be
 * shared serves the widest reader when nobody has declared otherwise.
 *
 * A language the framework does not ship is refused rather than silently
 * replaced. A page rendered in a language nobody asked for is a page whose
 * reader assumes the framework is broken.
 *
 * @param config - the project configuration, or null
 * @returns the dictionary for that language
 */
export function pageText(config) {
  const code = typeof config?.language === "string" ? config.language : "en";
  const path = join(PAGES_DIR, `${code}.json`);
  if (!existsSync(path)) {
    const shipped = readdirSync(PAGES_DIR)
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.replace(".json", ""))
      .join(", ");
    fail(`language "${code}" is not one the framework ships. Available: ${shipped}.`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}
