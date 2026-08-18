/**
 * Feuille de style partagee par les pages de relecture du pipeline.
 *
 * Une seule definition pour toutes les pages : deux copies divergeraient a
 * la premiere retouche, et l'operateur lirait deux produits differents selon
 * la page ouverte. Les couleurs passent par des jetons redefinis pour les
 * trois etats de theme possibles chez le lecteur — choix explicite clair,
 * choix explicite sombre, et le reglage systeme qui n'en stampe aucun.
 */
export const STYLE = `
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
 * Echappe un texte issu du store ou d'un handoff pour insertion dans du HTML.
 *
 * Le contenu vient d'un agent : il est traite comme une donnee et jamais
 * comme du balisage, sans quoi une spec pourrait injecter du script dans la
 * page que l'operateur lit pour decider.
 *
 * @param value - texte a echapper, converti en chaine si besoin
 * @returns le texte sans caractere actif pour le parseur HTML
 */
export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Rend un numero d'ordre sur deux chiffres.
 *
 * @param index - rang commencant a zero
 * @returns le rang affichable, commencant a un
 */
export function pad(index) {
  return String(index + 1).padStart(2, "0");
}

/**
 * Assemble une page autonome autour d'un corps deja rendu.
 *
 * @param title - titre de l'onglet et de la galerie
 * @param body - fragment HTML du contenu
 * @returns la page complete, sans aucune ressource externe a charger
 */
export function shell(title, body) {
  return `<title>${esc(title)}</title>\n<style>${STYLE}</style>\n<div class="wrap">\n${body}\n</div>\n`;
}

/**
 * Ce qu'un harnais capable doit faire de la page produite.
 *
 * Le framework ecrit un fichier et s'arrete la : il ne suppose ni qu'un
 * harnais sait heberger une page, ni qu'un navigateur existe, ni qu'un lien
 * peut etre rendu a l'operateur. Ces capacites appartiennent a l'outil qui
 * execute les agents, pas au pipeline, et un framework qui les supposerait
 * ne tournerait que sur celui pour lequel il a ete ecrit.
 *
 * La ligne est donc imprimee a l'endroit ou le pilote regarde deja — la
 * sortie de la commande — plutot qu'enfouie dans un document qu'il peut ne
 * pas avoir lu.
 */
export const SURFACE_HINT =
  "to publish: if the harness can host an HTML page, publish it and hand the operator the link; otherwise hand them this path. The file opens on its own, with no network and no dependency.";
