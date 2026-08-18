# Installer le pipeline dans un nouveau projet

Ce document s'adresse à l'agent qui configure le pipeline dans un dépôt qui ne le connaît pas encore. Il suppose que `agent-pipeline/` vient d'être copié à la racine du projet et que rien d'autre n'a été fait.

Il n'est pas une introduction au pipeline. Pour ce qu'il fait et pourquoi, lire `AGENTS.md` **après** l'avoir rendu, puis `state-machine.md` et `quality-gates.md`.

## Ce que tu configures, et ce que tu ne touches pas

`agent-pipeline/scripts/` est **agnostique** : ces scripts ne connaissent ni langage, ni framework, ni gestionnaire de paquets. Ils lisent le store, calculent l'ordonnancement, valident les handoffs. Tu n'y touches pas, et tu n'y introduis aucune dépendance de stack — la même règle vaut pour `agent-pipeline/prompts/`, `agent-pipeline/docs/` et `agent-pipeline/templates/`.

Tout ce qui parle de la stack ou de ce dépôt-ci vit dans cinq endroits, et ce sont les cinq que tu écris :

| Quoi | Où | Ce que ça porte |
| --- | --- | --- |
| La configuration | `pipeline.config.json` | commandes, `file_policy`, répertoires, surfaces à relecture humaine, CI |
| Les invariants | `<profiles_dir>/<profil>/invariants.md` | la section 9 d'`AGENTS.md` : ce qui est interdit dans ce langage |
| Les skills de stack | `<profiles_dir>/<profil>/skills/` | ce qu'un skill sait de cette stack et qui n'a pas sa place dans le core |
| Le contexte du dépôt | le fichier `project_context` | les trois blocs de `CLAUDE.md` : ce que le projet est, ses commandes locales, ses limites assumées |
| Les outils du projet | `scripts/` | la carte du projet, la politique de commentaires |
| Les standards | `docs/stack/` | conventions relues par QA |

Les skills, eux, se rangent selon une seule question : **ce skill parlerait-il encore juste dans un projet d'une autre stack ?** Si oui, il appartient à `agent-pipeline/skills/` et voyage avec le pipeline. Sinon il appartient au profil. Un skill d'interface web dans le core rendrait le core faux pour un projet Go ; `apply-profile` refuse d'ailleurs un même nom des deux côtés.

`AGENTS.md`, `CLAUDE.md`, le fichier `rules_path`, `.claude/agents/` et les skills installés dans `skills_dir` sont **générés** par `apply-profile`. Ne les écris jamais à la main : ta modification sera écrasée au prochain rendu, et `apply-profile --check` la signalera comme une dérive avant ça.

`CLAUDE.md` est chargé à chaque session et porte l'obligation de demander « pipeline ou direct » avant d'agir. Un dépôt sans lui démarre sans point d'entrée : cette obligation n'a lieu pour personne, et rien ne le signale — c'est pourquoi il est rendu et non laissé à ta bonne volonté.

## L'ordre, et la vérification après chaque étape

### 1. Nommer le profil et écrire ses invariants

Choisis un identifiant court et descriptif : `api-fastapi`, `web-svelte`, `cli-go`. Écris `<profiles_dir>/<profil>/invariants.md` — `profiles_dir` est déclaré dans ta config et vit à la racine du projet, jamais dans `agent-pipeline/` — une liste à puces, chacune vérifiable, chacune propre au langage.

Un invariant utile interdit quelque chose de précis que ce langage rend facile. « Écrire du code propre » n'est pas un invariant ; « aucun `any` » et « aucun `except:` nu » en sont.

Demande-toi, pour chaque puce : **quelle porte la fait échouer ?** Si la réponse est « aucune », soit tu ajoutes la porte à l'étape 3, soit tu retires la puce. Une règle que rien ne fait mordre s'auto-annule — c'est la leçon la plus chère de ce pipeline, et elle se réapprend dans chaque projet.

### 2. Écrire `pipeline.config.json`

Pars de celui du projet d'origine et remplace chaque valeur. Les clés `commands` sont un contrat : les prompts et les documents désignent les portes **par leur clé**, jamais par la commande. `check` doit rester la vérification de types quel que soit l'outil qui la rend.

Les clés obligatoires, refusées si absentes : `check`, `lint`, `build`, `test_unit`, `audit`, `secrets_scan`, `project_map`.

Les chemins obligatoires, refusés si absents : `profiles_dir`, `docs_dirs`, `briefs_dir`, `prompts_dir`, `skills_dir`, `rules_path`, `project_context`, `store_dir`.

Tu es libre de les ranger où tu veux, et c'est le but : rien de tout cela n'est figé dans le core. Grouper la machinerie sous un seul répertoire — `pipeline/profiles`, `pipeline/briefs`, `pipeline/store`, `pipeline/rules.json` — évite de disputer au projet hôte des noms qu'il veut pour lui, `docs/` et `scripts/` en tête. Seuls `AGENTS.md`, `CLAUDE.md`, `.claude/` et `pipeline.config.json` restent à la racine : la plateforme les y cherche.

`rules_path` est **semé** au premier rendu depuis `agent-pipeline/schemas/rules.json`, puis complété par la `file_policy` du profil. Tu n'as pas à le copier toi-même.

Pour un projet Python, par exemple, `check` devient `mypy .`, `lint` devient `ruff check . && ruff format --check .`, `test_unit` devient `pytest`. Pour un projet Svelte, `check` devient `svelte-check`, `test_unit` devient `vitest run`.

Adapte aussi :

- `file_policy` — les globs `deny` doivent couvrir les vrais chemins du projet ; l'entrée `implementer` est obligatoire ;
- `human_review_paths` — authentification, migrations, tout ce qui ne doit jamais être approuvé par une machine seule ;
- `project_map.roots` et `project_map.skip` — les racines à cartographier et le motif des fichiers de test ;
- `ci.provider` — `"none"` si tu n'installes pas de CI, et sache alors que QA exécutera réellement chaque porte au lieu de lire un run.

### 3. Écrire les outils du projet

Deux scripts vivent dans `scripts/` et sont propres à la stack.

#### La carte du projet : tu dois l'écrire, et ce n'est pas négociable

**Le générateur de carte hérité ne fonctionnera pas dans ton projet, et tu dois en écrire un.** C'est l'étape que ce guide te demande le plus explicitement, parce que c'est celle dont l'omission est la plus silencieuse.

Le script du projet d'origine importe le paquet `typescript` et ne collecte que les fichiers `.ts`. Dans un projet Python ou Go, il ne démarre même pas — `Cannot find package 'typescript'`. C'est le cas **heureux** : l'échec est bruyant. Le cas malheureux est un projet où il démarre, ne trouve aucun fichier correspondant, écrit une carte vide, et où `--check` compare vide à vide et **sort en 0**.

**Ce que le pipeline perd si tu sautes cette étape.** `docs/project-map.md` est la réponse à « est-ce que ça existe déjà ? », lue avant de créer un module, un service, un helper ou un harnais de test. La **note de réutilisation exigée de tout ajout est jugée contre elle** : sans carte juste, cette note n'est plus jugeable par personne, et la porte qui la réclame devient une formalité. Les agents recréent alors ce qui existe déjà, chacun de leur côté, sans qu'aucune porte ne s'en aperçoive — et le pipeline perd la mémoire de ce qu'il a construit.

Ce n'est donc pas un outil de confort. C'est le seul mécanisme par lequel le pipeline sait ce qu'il contient.

**Ce que le core exige, et rien de plus** : un chemin de sortie, une régénération, et un `--check` qui sort en 1 quand la carte est périmée. Le langage du générateur est libre — écris-le dans celui du projet. En Python, le module `ast` de la bibliothèque standard suffit ; en Go, `go/ast` ; en JavaScript ou TypeScript, l'API du compilateur.

**Ce qu'il doit produire** : chaque export public avec sa nature et le rôle que sa documentation lui donne, harnais de test compris.

**Comment prouver qu'il marche, par une commande et pas par une lecture :**

```
node agent-pipeline/scripts/map-coverage.mjs
```

Il compte les fichiers de source sous `project_map.roots`, retire ceux que `skip` écarte, et exige que **chacun** soit cité dans la carte rendue. Il ne connaît ni ton langage ni le format de ta carte : il apparie sur le nom de fichier. Sortie 1 si un seul manque, sortie 1 aussi si aucun fichier de source n'est trouvé — ce qui attrape une `roots` mal réglée.

C'est ce contrôle qui distingue une carte vide d'une carte à jour. La porte `project_map` compare la carte à sa régénération : elle attrape une carte **périmée**, jamais une carte **vide**. Les deux passent au vert quand le générateur ne collecte rien.

Lance-le après chaque régénération, et fais-en une porte de ta configuration si tu veux qu'il morde tout seul.

**Si tu décides de ne pas porter la carte**, supprime le script hérité au lieu de le laisser en place. Un script mort qui porte le nom d'une porte est pire qu'un script absent : le prochain agent lira son nom dans la config et le croira actif.

**La politique de commentaires** interdit la narration et n'accepte que les contrats sur les exports. La syntaxe des commentaires change avec le langage ; les racines scannées aussi.

### 4. Rendre, puis vérifier que le rendu est réel

`apply-profile` refuse de rendre sans le fichier `project_context` et te donne le chemin manquant. Écris ses trois blocs — `<!-- claude:summary -->`, `<!-- claude:commands -->`, `<!-- claude:context -->` — avant de lancer la commande ; un bloc vide est refusé comme un fichier absent.

```
node agent-pipeline/scripts/apply-profile.mjs
node agent-pipeline/scripts/sync-briefs.mjs
node <ton script de carte>
```

Puis, et c'est l'étape que personne ne saute :

```
node agent-pipeline/scripts/apply-profile.mjs --check
node agent-pipeline/scripts/sync-briefs.mjs --check
node <ton script de carte> --check
```

Les trois doivent sortir en 0. Ces trois `--check` sont les cibles générées : un dépôt dont l'une dérive travaille sur une politique périmée sans le savoir.

### 5. Prouver que chaque porte mord

**Ne te contente pas de lancer les portes et de les voir vertes.** Une porte verte sur un dépôt sain ne prouve rien : elle peut être verte parce qu'elle ne mesure rien.

Pour chaque commande de `commands`, casse volontairement ce qu'elle est censée attraper et vérifie qu'elle échoue :

| Porte | Ce que tu casses | Ce que tu attends |
| --- | --- | --- |
| `check` | une erreur de type évidente | code ≠ 0 |
| `lint` | un fichier mal formaté | code ≠ 0 |
| `test_unit` | inverse une assertion | code ≠ 0 |
| `coverage` | vérifie qu'elle exécute **toutes** les suites qu'elle mesure | un fichier prouvé seulement en e2e ne doit pas compter comme non couvert |
| `mutation` | vérifie qu'elle n'a pas réutilisé son cache | un rapport « n of n reused » n'a rien mesuré |
| `project_map` | ajoute un export sans régénérer | code ≠ 0 |
| `secrets_scan` | ajoute une fausse clé | code ≠ 0 |

Rétablis après chaque essai.

Deux lignes de ce tableau viennent de défauts réellement trouvés sur le projet d'origine, portes vertes : `coverage` collectait sur tout le code source mais n'exécutait qu'une seule suite, et `mutation` réutilisait son cache — son propre rapport annonçait « 31 of 31 mutant result(s) are reused ». Les deux ont été corrigées là-bas.

La ligne `project_map` est d'une autre nature, et la distinction compte pour toi. Le projet d'origine est en TypeScript et sa carte ne collecte que les `.ts` : elle y est donc **exacte**, et il n'y a rien à y corriger. Le piège n'apparaît qu'au portage, au moment où la stack change et où un script hérité continue de chercher des fichiers qui n'existent plus. C'est le défaut le plus difficile à voir, parce qu'il naît d'un outil qui était juste ailleurs.

### 6. Installer les crochets

`pre-commit` lance le format, `lint` et `secrets_scan`. `pre-push` lance `check`, `lint` et les trois `--check` de cibles générées. Sans eux, les règles de l'étape 4 ne sont déclenchées par rien.

Vérifie qu'ils sont **installés**, pas seulement écrits : un `.git/hooks/` qui ne contient que des `.sample` signifie qu'aucun crochet ne tourne.

### 7. Amorcer le store

Le store est `<store_dir>/issues.jsonl` et `<store_dir>/specs.jsonl`. Deux fichiers vides suffisent à démarrer.

```
node agent-pipeline/scripts/store-verify.mjs
node agent-pipeline/scripts/next-step.mjs
```

Le premier doit annoncer les invariants respectés, le second qu'aucun pas n'est à exécuter. Le pipeline est prêt.

## Le point de contrôle final

Avant de rendre la main, réponds à ces questions par une commande, jamais par une lecture :

1. `apply-profile --check`, `sync-briefs --check` et la carte `--check` sortent-ils tous en 0 ?
2. **As-tu écrit le générateur de carte, et cite-t-il réellement le code ?** Compte les fichiers sous `roots` face aux entrées rendues. Un `--check` vert sur une carte vide est vert.
3. Chaque porte de `commands` a-t-elle échoué au moins une fois, sur une casse volontaire ?
4. `preflight` confirme-t-il que **chaque porte déclarée est exécutable** ? Une porte injouable échoue au lieu de protéger.
5. Les crochets sont-ils installés et se déclenchent-ils ?
6. `store-verify` est-il vert ?
7. Chaque invariant du profil a-t-il une porte qui le fait échouer ?

Une réponse « je pense que oui » à l'une de ces sept questions est une réponse non.

## Ce que tu ne décides pas

Trois choses restent à l'opérateur humain, dans tous les profils : **installer une dépendance**, **éditer `pipeline.config.json`** une fois le pipeline en service, et **merger**. Pendant l'installation initiale tu écris la configuration — c'est son objet — mais dès que le pipeline tourne, elle passe sous la main de l'opérateur.

Signale, n'invente pas : une commande indisponible se remonte, elle ne se remplace jamais par un substitut qui prétend prouver le système réel.

## La porte `design_limits`, exigée de tout profil

`apply-profile` refuse une configuration sans `commands.design_limits`. Le core ne connaît pas votre outil, mais il exige qu'une porte borne quatre choses :

| Borne | Ce qu'elle approxime |
| --- | --- |
| complexité cyclomatique | KISS, et un proxy de responsabilité unique |
| longueur d'une fonction | responsabilité unique |
| nombre de paramètres | ségrégation d'interface |
| profondeur d'imbrication | KISS |

**Ce ne sont pas SOLID.** Ce sont des approximations mesurables de ce que SOLID protège : une fonction de deux cents lignes viole presque toujours la responsabilité unique, l'inverse n'est pas vrai. Une porte imparfaite qui mord vaut mieux qu'un principe que personne ne vérifie — et sans elle, la responsabilité unique s'auto-annule, le code n'étant bon que si le modèle l'est.

**Ouvert-fermé et Liskov ne sont pas approximables** et restent en revue humaine. Écrivez-le dans les invariants du profil plutôt que de laisser croire qu'ils sont couverts.

Trois exigences de forme, apprises en la posant :

- **Calibrez sur le code réel avant de figer les seuils.** Mesurez les maximums constatés, placez la borne au-dessus. Un chiffre rond choisi d'avance casse au premier passage, puis se desserre — et une porte desserrée une fois se desserre toujours.
- **Séparez-la de la porte de style.** Une fonction devenue trop complexe n'est pas une faute de formatage ; les confondre fait lire les deux de la même façon, c'est-à-dire distraitement.
- **Exemptez les blocs de test de la limite de longueur.** Un scénario long décrit un parcours, ce n'est pas une dette.

L'outil est libre : `eslint` pour TypeScript, `pylint` avec `max-complexity` pour Python, `gocyclo` pour Go. Le core ne voit qu'une clé et un code de sortie.

## Ce que la porte d'agnosticité refuse

Porter le pipeline vers une autre stack révèle les couplages qu'on n'a pas vus en l'écrivant. Cinq d'entre eux sont désormais refusés par `agent-pipeline/test/agnosticite.test.mjs`, donc constatés avant le portage et non pendant :

- aucun script du core n'invoque le lanceur de tâches d'un écosystème — un projet Python, Go ou Rust n'a pas de `package.json`, et le core ne dépend que de Node ;
- aucun script du core n'importe un paquet installé : modules natifs et voisins relatifs seulement, parce que le core ne s'installe pas ;
- aucun script du core n'écrit en dur un chemin que la configuration possède (`rules_path`, `store_dir`, `briefs_dir`, `profiles_dir`) ;
- chaque étape CI du core s'exécute par `node` en direct, jamais par la stack du projet ;
- les étapes de la stack restent un emplacement à remplir dans le template, jamais une commande écrite.

La comparaison porte sur le code privé de ses commentaires : une consigne peut légitimement citer `npm` en prose, seule une invocation est un couplage. Le fichier de la porte s'exclut lui-même, et c'est nommé plutôt que contourné — un motif tordu pour ne pas se voir finit par ne plus voir ce qu'il cherche.

## Choisir l'architecture, à la configuration

```
node agent-pipeline/scripts/render-architecture.mjs <sortie.html> <backend|frontend|mobile|fullstack>
```

Sans analyse jointe, la page pose d'abord **huit questions en langue ordinaire** — une sorte de cahier des charges non définitif. C'est l'ordre qui compte : présenter huit options à quelqu'un qui n'a pas encore décrit son produit, c'est un catalogue, pas une aide à la décision.

**B3 est la question qui détecte le métier** : *y a-t-il des situations où le système doit REFUSER quelque chose ?* Pas un champ obligatoire ni un format — un vrai refus, « ce livre est déjà sorti », « ce compte n'a pas assez ». Un système qui ne refuse jamais rien pour une raison venue du monde réel n'a pas de métier, il a un schéma. **B4 vérifie** que les refus cités en sont : un professionnel du métier les comprendrait-il sans qu'on parle informatique ?

Les réponses deviennent une analyse structurée, jointe en troisième argument. La page rend alors un **conseil argumenté** : chaque option reçoit un verdict et ses raisons, tirées de l'analyse et citées. « Aucune intégration déclarée remplaçable : les ports seraient une assurance dont vous n'encaisserez jamais l'intérêt » se discute ; un classement sans motif s'accepte.

L'analyse doit porter `business_rules`, même vide : dire qu'il n'y en a aucune est une conclusion, pas un oubli, et le validateur refuse le champ absent.

Le framework **ne choisit pas** l'architecture : ce serait imposer une réponse à une question qui dépend du produit. Il rend le choix explicable, puis opposable.

Le type de projet filtre le catalogue, et ce n'est pas cosmétique — il change la réponse. Un service back-end voit l'hexagonale et Clean ; une interface web voit le découpage en tranches et MVVM, et ne voit pas les ports, qui répondent à une contrainte qu'elle n'a pas. Un depot full-stack reçoit en plus la seule question qui compte vraiment chez lui : **ce qui traverse la frontière entre les deux côtés**, parce que c'est elle qui décide de ce qui casse quand un côté bouge.

La page ouvre sur les **questions qui décident** avant tout nom d'architecture. La première élimine le plus d'options à elle seule : *combien d'adaptateurs allez-vous réellement remplacer ?* Si la réponse est zéro — et pour une base de données c'est presque toujours zéro — les ports sont une cérémonie que chaque nouvelle route paie.

Chaque option publie **la déclaration que la configuration portera** : ses couches et le sens autorisé des dépendances. L'opérateur lit donc exactement ce que la porte appliquera, au lieu de choisir un nom et de découvrir la contrainte à l'implémentation.

Le profil traduit ensuite cette déclaration en porte pour sa stack — zones d'import pour TypeScript, équivalent ailleurs — et la règle rejoint `invariants.md`, où chaque puce nomme la porte qui la refuse. Une architecture qui ne serait écrite que dans un document ne serait pas une architecture : ce serait une intention.

## Savoir quand l'architecture ne tient plus

```
node agent-pipeline/scripts/architecture-drift.mjs <graphe.json>
```

Le choix initial n'a pas à être définitif ; encore faut-il savoir quand il a cessé de convenir. Le détecteur confronte le graphe de dépendances aux signes écrits dans le catalogue : un module qui en importe trois autres, deux modules qui s'importent mutuellement, un fichier partagé à un seul consommateur, un partage devenu fourre-tout, un module trois fois plus gros que les autres. Chaque signal dit ce qu'il **signifie** et ce qu'il faut **regarder ensuite** — un signal sans suite est une alarme, pas un diagnostic.

**Le framework juge, il n'extrait pas.** Lire des imports demande de connaître un langage ; le core n'en connaît aucun. Le projet fournit donc le graphe sous une forme neutre — `modules`, leurs `files` et leurs `imports`, les fichiers `shared` avec leurs consommateurs, et la `composition_root` — et cette frontière est ce qui rend le détecteur portable. L'extracteur, lui, appartient au projet : il connaît le langage, donc il ne peut pas vivre dans le cadre.

Deux précautions valent d'être connues, parce qu'elles décident si le détecteur sera lu ou ignoré :

- **il se tait sur un projet jeune.** En dessous de quatre modules et vingt fichiers, un partage à un seul consommateur se déclenche systématiquement et à tort — le second module n'existe simplement pas encore. Il l'annonce au lieu de se taire en silence ;
- **la racine de composition est exclue.** Le fichier qui assemble l'application importe légitimement tout le monde ; le compter comme un couplage produirait une alarme permanente, et une alarme permanente ne se lit plus.

Ce qu'il **ne voit pas**, et qu'il écrit à chaque exécution : deux modules qui appliquent la **même règle métier** avec un code différent. Un graphe d'imports ne voit pas le sens. Ce déclencheur-là se constate en relisant, jamais en calculant, et le prétendre couvert serait pire que de ne pas le chercher.
