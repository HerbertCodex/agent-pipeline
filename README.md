# no-name-driven

Un cadre de travail pour faire écrire du logiciel par des agents, où **chaque règle qui compte est adossée à une commande qui échoue**.

Quatre rôles se passent le travail — **Product** découpe une demande en spec puis en issues, **Implementer** épingle les critères en tests rouges, prouve le rouge, puis implémente, **QA** vérifie dans l'environnement réel, l'**Orchestrateur** valide, persiste et ordonnance. L'état durable vit dans un store sur disque, jamais dans la mémoire d'un agent : une coupure au milieu d'un cycle est indolore.

Ce dépôt est **le cadre**, pas un projet. Il ne connaît ni langage, ni framework, ni gestionnaire de paquets. Il se copie tel quel dans un dépôt Python, Go, Rust ou Svelte.

> **La règle qui a coûté le plus cher à réapprendre.** Une consigne que rien ne fait mordre s'auto-annule. Un prompt qui demande de lire un fichier « s'il existe », un mécanisme documenté qu'aucun script ne vérifie : personne n'échoue, personne ne signale, et la règle n'a jamais lieu. Si une règle compte, elle a une porte ou un validateur derrière elle. Ce cadre applique cette doctrine à lui-même — ses 120 tests existent parce que le code qui décide si le code est prouvé n'était prouvé par personne.

---

## Ce qu'il vous faut

| Prérequis | Pourquoi |
| --- | --- |
| **Node** | les scripts du cadre sont en `.mjs` |
| **git** | le pipeline travaille par branches et par commits |
| **Le client de votre forge** | Product ouvre les pull requests |

Rien d'autre ne vient du cadre. Tout le reste vient de **votre** configuration, et c'est là qu'est le piège : les outils que vos portes appellent ne s'installent pas avec les dépendances du projet. L'analyse de secrets est le cas le plus fréquent — son outil est presque toujours un binaire externe.

Un prérequis manquant ne se manifeste pas par une absence, mais par une **porte qui échoue au lieu de protéger**. Et une porte qui échoue toujours finit par être contournée : le dépôt affirme alors une protection que personne n'exerce.

---

## Démarrer un nouveau projet

### 1. Poser le cadre

```bash
cd mon-projet
git clone https://github.com/HerbertCodex/no-name-driven.git agent-pipeline
rm -rf agent-pipeline/.git
```

Le répertoire **doit** s'appeler `agent-pipeline/` : c'est le chemin que les documents et les prompts citent.

### 2. Décrire le produit, avant toute technique

Lancez votre session d'agents et demandez-lui de vous poser les **huit questions de cadrage**. Elles se répondent en langue ordinaire, sans vocabulaire technique.

Deux comptent plus que les six autres :

> **B3** — Y a-t-il des situations où le système doit **refuser** quelque chose ? Pas un champ obligatoire ni un format : un vrai refus, « ce livre est déjà sorti », « ce compte n'a pas assez ».
>
> **B4** — Ces refus, un professionnel du métier les comprendrait-il **sans qu'on parle informatique** ?

C'est ce qui détermine s'il y a un métier à protéger ou seulement un schéma à remplir. Presque tout le reste en découle. Un système qui ne refuse jamais rien pour une raison venue du monde réel n'a pas de métier.

### 3. Choisir comment ranger le code

```bash
node agent-pipeline/scripts/render-architecture.mjs archi.html <backend|frontend|mobile|fullstack> [analyse.json]
```

Sans analyse jointe, la page **pose les huit questions**. Avec l'analyse qu'en tire votre session, elle rend un **conseil argumenté** : chaque option reçoit un verdict *pour votre projet* et ses motifs, tirés de votre analyse et cités.

Le cadre **ne choisit pas à votre place** — la bonne réponse dépend du produit. Il explique, puis rend votre choix opposable.

Trois principes que la page défend, et qui évitent l'erreur la plus courante :

- **Ne prenez pas le plus lourd par précaution.** C'est payer tout de suite une assurance qu'on n'utilisera peut-être jamais, prélevée sur chaque fichier écrit pendant des années.
- **Partir simple garde les options ouvertes ; partir compliqué les ferme.** On durcit un dossier le jour où il l'a mérité, sans toucher aux autres. Personne, en revanche, ne retire des couches.
- **Vous n'avez pas à deviner l'avenir.** Chaque option dit les signes concrets qui annonceront qu'il est temps d'en changer.

### 4. Installer le pipeline

Donnez ceci à votre agent, en remplaçant `<stack>` :

```text
Ce dépôt contient un cadre d'agents dans agent-pipeline/. Il n'est pas encore
configuré pour ce projet, qui est en <stack>.

Lis agent-pipeline/docs/nouveau-profil.md et suis-le du début à la fin.

Le générateur de carte de projet est l'étape à ne pas survoler : tu dois en
écrire un pour cette stack. Un --check vert sur une carte vide est vert.

Ne me rends la main qu'après avoir répondu aux six questions du point de
contrôle final — chacune par une commande et sa sortie réelle, jamais par une
appréciation.

Deux choses restent à moi : installer une dépendance, et éditer
pipeline.config.json une fois le pipeline en service. Demande-les moi.
```

Il écrira le profil, la configuration, les outils du projet, rendra les cibles générées, installera les crochets et amorcera le store.

### 5. Vérifier avant de le croire

Six questions, et le guide est explicite : **« je pense que oui » est une réponse non.** Chacune se répond par une commande.

1. `apply-profile --check`, `sync-briefs --check` et la carte `--check` sortent-ils tous en 0 ?
2. Le générateur de carte cite-t-il **réellement** le code ? Comptez les fichiers face aux entrées rendues.
3. **Chaque porte a-t-elle échoué au moins une fois, sur une casse volontaire ?**
4. Les crochets sont-ils installés et se déclenchent-ils ?
5. `store-verify` est-il vert ?
6. Chaque invariant du profil a-t-il une porte qui le fait échouer ?

La troisième est celle qu'on saute, et c'est celle qui compte. Vérifiez aussi que votre casse **casse vraiment** : un motif de remplacement qui ne trouve rien laisse la porte verte et ne prouve rien.

---

## Écrire la première spec

Product travaille en **deux phases**, et vous êtes entre les deux.

**Phase 1 — la proposition.** Périmètre fonctionnel en langue produit : les fonctionnalités, ce que chacune apporte à une personne réelle, les règles métier, et **ce qu'on ne construit délibérément pas**. Aucune issue. Autant de tours qu'il faut.

```bash
node agent-pipeline/scripts/render-proposal.mjs proposition.json spec.html
```

**Phase 2 — le découpage**, dérivé de la proposition que vous avez approuvée. Le plan porte l'empreinte du document approuvé : `validate-handoff` refuse un découpage dérivé d'autre chose, ou d'une proposition **modifiée après votre accord**.

Ce que le validateur refuse en phase 1 : une proposition sans périmètre fonctionnel, une fonctionnalité sans règle métier, un `out_of_scope` absent, un choix soumis sans alternative, une proposition qui porte déjà des issues, et tout tour au-delà du premier qui ne dit pas ce que vous avez demandé.

Un tour où il ne reste rien à trancher se **déclare** (`scope_final: true`) au lieu de s'inventer une question : une porte qui force à fabriquer apprend à fabriquer.

---

## Vivre avec

```bash
node agent-pipeline/scripts/next-step.mjs            # le pas suivant, calculé depuis le store
node agent-pipeline/scripts/next-issues.mjs          # ce qui peut partir en parallèle
node agent-pipeline/scripts/render-decisions.mjs q.html   # ce qui attend votre décision
node agent-pipeline/scripts/architecture-drift.mjs g.json # quand la forme ne tient plus
node agent-pipeline/scripts/metrics.mjs              # débit et défauts échappés
node agent-pipeline/scripts/status.mjs               # état d'ensemble
```

`render-decisions` est **calculée**, pas rédigée : une issue dont aucun rôle ne peut prendre le périmètre y figure même si personne ne l'a signalée.

`architecture-drift` **se tait sur un projet jeune** et l'annonce, parce qu'un détecteur qui crie sur trois modules apprend surtout à être ignoré.

---

## Ce qui reste à vous, toujours

**Installer une dépendance.** Un agent qui peut ajouter un paquet peut contourner n'importe quelle contrainte en important une bibliothèque qui la contourne.

**Éditer `pipeline.config.json`.** C'est le fichier qui définit les portes. Un agent qui peut les redéfinir peut les rendre vertes.

**Merger.** QA valide une issue ; elle ne garantit pas la composition entre issues.

---

## Ce qu'il y a dans la boîte

| | |
| --- | --- |
| `scripts/` | 24 scripts, tous en Node, sans aucune dépendance installée |
| `prompts/` | les quatre rôles |
| `docs/` | dont **`nouveau-profil.md`**, le guide de portage, et `operateur.md`, le manuel humain |
| `templates/` | `AGENTS.md`, `CLAUDE.md`, le workflow CI |
| `skills/` | ce qui ne dépend d'aucune stack |
| `test/` | 120 tests sur le cadre lui-même |
| `schemas/` | la forme des handoffs |

Une **porte d'agnosticité** refuse qu'un couplage à une stack entre ici : aucun script n'invoque de lanceur de tâches, aucun n'importe un paquet installé, aucun n'écrit en dur un chemin que la configuration possède, et chaque étape CI du cadre s'exécute par `node` en direct.

---

## Limites connues, écrites plutôt que découvertes

- **Les tests du cadre se lancent depuis un projet hôte**, pas depuis ce dépôt seul : le harnais copie le fichier de règles du projet pour ne pas prouver une copie divergente à sa place.
- **Les profils vivent côté projet.** Copier ce dépôt n'apporte donc pas les portes d'une stack donnée : pour un second projet du même type, elles se réécrivent. Une réserve de profils partagés reste à concevoir.
- **Rien ne déclenche les pages de relecture.** Le cadre les produit et dit ce qu'un harnais capable doit en faire ; c'est la session qui doit y penser. Une discipline, pas une porte — et par la doctrine ci-dessus, c'est une faiblesse assumée.
- **Aucun étalon externe.** Le cadre mesure son propre débit et ses défauts échappés ; il ne prouve pas encore qu'il fait mieux qu'une session directe.
- Les exemples de certains skills de patrons sont à coloration JavaScript. C'est un biais de rédaction, pas un couplage.
