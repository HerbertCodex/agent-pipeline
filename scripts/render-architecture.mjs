import { writeFileSync } from "node:fs";
import { fail } from "./lib.mjs";
import { esc, pad, shell, SURFACE_HINT } from "./page.mjs";
import { PROJECT_TYPES, DECISION_AXIS, ARCHITECTURES, FULLSTACK_BOUNDARY } from "./architectures.mjs";
import { readFileSync, existsSync } from "node:fs";
import { BRIEF_QUESTIONS, judge, summarise } from "./discovery.mjs";

/**
 * Rend le sens des dependances en chaine de boites flechees.
 *
 * Une fleche se lit en une seconde la ou une phrase demande un paragraphe :
 * c'est la seule information de structure qui doit etre saisie avant de lire
 * quoi que ce soit d'autre.
 *
 * @param chain - couches, de la plus exterieure a la plus interieure
 * @returns le fragment HTML de la chaine
 */
function arrows(chain) {
  const boxes = chain
    .map((layer, index) => {
      const last = index === chain.length - 1;
      return `<span class="box${last ? " core" : ""}">${esc(layer)}</span>${last ? "" : '<span class="arrow">→</span>'}`;
    })
    .join("");
  return `<div class="chain">${boxes}</div>
<p class="chain-legend">se lit : « ${esc(chain[0])} peut utiliser ${esc(chain[1] ?? chain[0])}${
    chain.length > 2 ? " et la suite" : ""
  }, jamais l'inverse »</p>`;
}

/**
 * Rend une architecture en carte lisible d'un coup d'oeil.
 *
 * L'ordre est deliberé : en clair, puis l'arborescence, puis le cout reel en
 * fichiers, puis seulement les nuances. Qui s'arrete apres les trois premiers
 * blocs a deja de quoi choisir.
 *
 * @param entry - architecture du catalogue
 * @param index - rang d'affichage
 * @param example - action concrete servant d'unite de cout
 * @returns le fragment HTML de la carte
 */
function card(entry, index, example) {
  return `<article class="feature">
<header><span class="num">${pad(index)}</span><h3>${esc(entry.name)}</h3></header>
<p class="plain">${esc(entry.plain)}</p>

<div class="split">
<div>
<p class="lbl">À quoi ça ressemble</p>
<pre class="tree">${entry.tree.map((line) => esc(line)).join("\n")}</pre>
</div>
<div>
<p class="lbl">Sens des dépendances</p>
${arrows(entry.chain)}
</div>
</div>

<p class="lbl">Pour ${esc(example)} : ${entry.files_for_example.length} fichiers</p>
<ul class="files">${entry.files_for_example.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>

<ol class="rules">
<li><span class="rid">Coût</span><p>${esc(entry.cost)}</p></li>
<li><span class="rid">Gain</span><p>${esc(entry.buys)}</p></li>
<li><span class="rid">Piège</span><p>${esc(entry.wrong_when)}</p></li>
</ol>
<p class="lbl">Quand le projet grossira</p>
<p class="grow">${esc(entry.grows_into)}</p>
<ul class="alts">${entry.migration_triggers.map((t) => `<li><span>${esc(t)}</span></li>`).join("")}</ul>
<p class="cost-move"><strong>Coût du changement —</strong> ${esc(entry.migration_cost)}</p>

<p class="note"><strong>En résumé.</strong> ${esc(entry.verdict)}</p>
</article>`;
}

/**
 * Rend le tableau de comparaison place avant les fiches detaillees.
 *
 * Il existe pour qu'on puisse choisir sans tout lire : le detail vient
 * apres, pour celui qui hesite entre deux lignes.
 *
 * @param retained - architectures retenues pour ce type de projet
 * @param example - action concrete servant d'unite de cout
 * @returns le fragment HTML du tableau
 */
function table(retained, example) {
  const rows = retained
    .map(
      (entry) => `<tr><td><strong>${esc(entry.name)}</strong></td>
<td>${entry.files_for_example.length}</td>
<td>${esc(entry.verdict.split(".")[0])}.</td></tr>`,
    )
    .join("");
  return `<div class="tablewrap"><table>
<thead><tr><th>Option</th><th>Fichiers pour ${esc(example)}</th><th>Quand c'est le bon choix</th></tr></thead>
<tbody>${rows}</tbody></table></div>`;
}

/**
 * Rend la page qui explique les architectures et demande un choix.
 *
 * Le framework n'impose aucune architecture : il rend le choix explicable,
 * puis opposable. Le type de projet filtre le catalogue parce qu'il change
 * la reponse — un catalogue non filtre transforme une decision en revision
 * de litterature.
 *
 * Usage : node render-architecture.mjs <sortie.html> <backend|frontend|mobile|fullstack>
 */
function questionnaire() {
  const items = BRIEF_QUESTIONS.map(
    (item) => `<div class="open">
<h3><span class="qid">${esc(item.id)}</span>${esc(item.question)}</h3>
<p class="short">${esc(item.hint)}</p>
<p class="reveals">Ce que la reponse revele — ${esc(item.reveals)}</p>
</div>`,
  ).join("");
  return `<section><div class="sec-head"><h2>D'abord : de quoi parle ce projet ?</h2>
<p>Huit questions, en langue ordinaire. Repondez-y avant de regarder la moindre architecture — c'est ce qui transforme une recommandation generique en conseil argumente.</p></div>
<div class="features">${items}</div>
<p class="note"><strong>La question qui decide vraiment, c'est B3.</strong> Un systeme qui ne refuse jamais rien pour une raison venue du monde reel n'a pas de metier : il a un schema. Et B4 verifie que les refus cites en sont bien — « ce champ est obligatoire » n'en est pas un.</p></section>`;
}

/**
 * Rend la recommandation fondee sur l'analyse du projet.
 *
 * @param retained - architectures pertinentes pour le type de projet
 * @param analysis - analyse issue du cahier des charges
 * @returns le fragment HTML de la recommandation
 */
function recommendation(retained, analysis) {
  const judged = retained
    .map((entry) => ({ entry, ...judge(entry, analysis) }))
    .sort((a, b) => a.rank - b.rank);
  const rows = judged
    .map(
      (item) => `<div class="open${item.verdict === "recommande" ? "" : " muted"}">
<h3><span class="chip${item.verdict === "recommande" ? "" : " alarm"}">${esc(item.label)}</span>${esc(item.entry.name)}</h3>
<ul class="alts">${item.reasons.map((reason) => `<li><span>${esc(reason)}</span></li>`).join("")}</ul>
</div>`,
    )
    .join("");
  const rules = analysis.business_rules ?? [];
  const validations = analysis.validations ?? [];
  return `<section><div class="sec-head"><h2>Ce que votre projet dit de lui-meme</h2>
<p>${esc(summarise(analysis))}</p></div>
${rules.length > 0 ? `<p class="lbl">Regles metier reperees</p><ol class="rules">${rules.map((r, i) => `<li><span class="rid">R${i + 1}</span><p>${esc(r.rule)}${r.why_it_matters ? ` — <em>${esc(r.why_it_matters)}</em>` : ""}</p></li>`).join("")}</ol>` : '<p class="empty">Aucune regle metier reperee : ce produit enregistre et restitue.</p>'}
${validations.length > 0 ? `<p class="lbl">Ce qui n'en est pas</p><ul class="files">${validations.map((v) => `<li>${esc(v)}</li>`).join("")}</ul>` : ""}
<div class="sec-head" style="margin-top:1rem"><h2>Notre conseil, et pourquoi</h2>
<p>Fonde sur l'analyse ci-dessus, pas sur une preference generale. Le detail de chaque option reste plus bas.</p></div>
<div class="features">${rows}</div></section>`;
}

function main() {
  const [target, type, analysisPath] = process.argv.slice(2);
  if (!target || !type) {
    fail(`usage : render-architecture.mjs <sortie.html> <${Object.keys(PROJECT_TYPES).join("|")}> [analyse.json]`);
  }
  const project = PROJECT_TYPES[type];
  if (project == null) {
    fail(`type de projet inconnu : ${type} (attendu ${Object.keys(PROJECT_TYPES).join(", ")})`);
  }

  const retained = ARCHITECTURES.filter((entry) => entry.applies.includes(type));
  const example = project.example;

  let analysis = null;
  if (analysisPath != null) {
    if (!existsSync(analysisPath)) fail(`analyse introuvable : ${analysisPath}`);
    analysis = JSON.parse(readFileSync(analysisPath, "utf8"));
    if (!Array.isArray(analysis.business_rules)) {
      fail("l'analyse doit porter business_rules, meme vide : dire qu'il n'y en a aucune est une conclusion, pas un oubli");
    }
  }

  const axis = DECISION_AXIS.map(
    (item, index) => `<div class="open">
<h3><span class="qid">Q${index + 1}</span>${esc(item.question)}</h3>
<p class="short">${esc(item.short)}</p>
<p>${esc(item.why)}</p>
<ul class="alts">${item.answers
      .map(([answer, effect]) => `<li><span><strong>${esc(answer)}</strong> — ${esc(effect)}</span></li>`)
      .join("")}</ul>
</div>`,
  ).join("");

  const boundary =
    type !== "fullstack"
      ? ""
      : `<section><div class="sec-head"><h2>Ce qui passe entre le front et le back</h2>
<p>Sur un dépôt full-stack, cette question compte plus que la structure interne de chaque côté : c'est elle qui décide de ce qui casse quand un côté bouge.</p></div>
<ol class="pledges">${FULLSTACK_BOUNDARY.map(
          (item, index) => `<li><span class="rid">${pad(index)}</span><p><strong>${esc(item.option)}</strong><br>
<em>Coût</em> — ${esc(item.cost)}<br><em>Gain</em> — ${esc(item.buys)}<br><em>Piège</em> — ${esc(item.wrong_when)}</p></li>`,
        ).join("")}</ol></section>`;

  const body = `<header class="masthead">
<p class="eyebrow">Configuration · choix d'architecture · ${esc(project.label)}</p>
<h1>Comment ranger le code de ce projet ?</h1>
<p class="lede">${esc(project.blurb)}</p>
<p class="verbatim">Une architecture, c'est <strong>où l'on range les fichiers</strong> et <strong>qui a le droit d'appeler qui</strong>. Rien de plus. Les noms compliqués désignent des façons de répondre à ces deux questions.<br><br>Le pipeline <strong>ne choisit pas à votre place</strong> : la bonne réponse dépend de votre produit. Il explique, puis rend votre choix opposable — une fois déclaré, un fichier qui appelle ce qu'il ne devrait pas fait échouer une porte au lieu d'être signalé en revue.</p>
</header>

${analysis == null ? questionnaire() : recommendation(retained, analysis)}

<section><div class="sec-head"><h2>En un coup d'œil</h2>
<p>${retained.length} options pertinentes pour ce type de projet. Le détail est plus bas si vous hésitez entre deux lignes.</p></div>
${table(retained, example)}</section>

<section><div class="sec-head"><h2>Les quatre questions qui décident</h2>
<p>Répondez-y avant de regarder les noms. Elles se répondent sans rien connaître à l'architecture, et elles éliminent la plupart des options.</p></div>
<div class="features">${axis}</div></section>

<section><div class="sec-head"><h2>Le détail de chaque option</h2>
<p>${retained.length} retenues sur ${ARCHITECTURES.length}. Les autres ne sont pas mauvaises : elles résolvent des problèmes que ce type de projet n'a pas.</p></div>
<div class="features">${retained.map((entry, index) => card(entry, index, example)).join("")}</div></section>

${boundary}

<section><div class="sec-head"><h2>« Et si je me trompe ? »</h2>
<p>C'est la bonne objection. Au début d'un projet, on ne sait pas encore tout — et pourtant il faut ranger les fichiers quelque part.</p></div>
<p class="note"><strong>Ne choisissez pas le plus lourd par précaution.</strong> C'est l'erreur la plus courante : on paie tout de suite une assurance qu'on n'utilisera peut-être jamais, et le coût est prélevé sur chaque fichier écrit, pendant des années.<br><br>
<strong>Ce qui décide, c'est une asymétrie.</strong> Partir simple garde les options ouvertes : on durcit un dossier le jour où il l'a mérité, sans toucher aux autres. Partir compliqué les ferme : personne ne retire des couches, on les subit. Un mauvais choix simple se corrige par morceaux ; un mauvais choix lourd, on vit avec.<br><br>
<strong>Ici, changer d'avis se mesure.</strong> Votre architecture est déclarée dans la configuration et vérifiée par une porte. Le jour où vous changez la déclaration, la porte vous imprime <em>la liste exacte</em> des fichiers qui ne respectent plus la nouvelle règle. Une migration devient une liste de tâches, pas une exploration — et c'est la différence avec un projet où l'architecture ne vit que dans la tête des gens.</p></section>

<section><div class="sec-head"><h2>Et ensuite</h2></div>
<p class="note">Votre choix devient une ligne dans la configuration : les dossiers, et qui a le droit d'appeler qui. Le profil la traduit en règle vérifiée automatiquement.<br><br><strong>À savoir avant de choisir :</strong> changer d'architecture plus tard veut dire déplacer des fichiers dans tout le projet. Le moment le moins cher pour trancher est maintenant, avant la première ligne de code.</p></section>`;

  writeFileSync(target, shell(`Architecture — ${project.label}`, body));
  console.log(`ecrit : ${target} (${type}, ${retained.length} options sur ${ARCHITECTURES.length}, ${analysis == null ? "questionnaire" : "conseil fonde sur l'analyse"})`);
  console.log(SURFACE_HINT);
}

main();
