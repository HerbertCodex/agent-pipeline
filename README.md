# agent-pipeline

Une pipeline vérifiable pour coordonner des agents de développement sans dépendre d’un fournisseur.

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Core dependencies](https://img.shields.io/badge/core_dependencies-0-blue)](#prérequis)
[![Agent runtimes](https://img.shields.io/badge/runtimes-Codex%20%7C%20Claude%20Code%20%7C%20Kilo%20Code%20%7C%20CLI-purple)](#agnostique-par-construction)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Le projet transforme un développement multi-agent en workflow observable et borné :

- quatre rôles aux responsabilités séparées ;
- un état persistant avec transitions contrôlées ;
- des paquets de travail compacts plutôt qu’un contexte toujours croissant ;
- des preuves attachées aux commits et aux critères ;
- des boucles limitées, des découvertes garées et une vraie condition d’arrêt.

Le principe central est simple : une règle importante doit pouvoir échouer dans une commande. Une consigne présente uniquement dans un prompt reste un conseil.

## Pourquoi

Une orchestration d’agents devient vite lente et interminable lorsque :

- l’utilisateur ne voit rien pendant plusieurs minutes ;
- chaque agent relit toute la documentation ;
- les découvertes élargissent silencieusement la tâche en cours ;
- les validations lourdes sont rejouées à chaque transition ;
- plusieurs rôles modifient le même état ;
- « terminé » dépend d’une appréciation plutôt que de preuves vérifiables.

agent-pipeline traite ces problèmes comme des propriétés de workflow.

| Problème | Mécanisme |
| --- | --- |
| Exécution opaque | événements NDJSON, étapes annoncées, heartbeat et interruption propagée |
| Contexte trop large | paquet borné par rôle, brief compilé et empreinte de l’enregistrement |
| Périmètre qui grossit | critères figés une fois le travail actif, découvertes garées par défaut |
| Coût disproportionné | voies de risque et nombre maximal de transitions par exécution |
| État concurrent | écrivain unique, verrou global, verrou optimiste et écriture atomique |
| Boucles de correction infinies | budget de rejets QA et escalade opérateur |
| Validation déclarative | commandes configurées, preuves par SHA et contrôle du diff réel |

## Architecture

~~~mermaid
flowchart LR
    U[Opérateur] --> O[Orchestrator]
    U --> SU[Sudocode UI / CLI]
    SU --> ST[(.sudocode issues + specs)]
    ST --> O
    O --> P[Product]
    O --> I[Implementer]
    O --> Q[QA]
    P -->|handoff JSON| O
    I -->|handoff JSON| O
    Q -->|handoff JSON| O
    O --> S[(Pipeline control store)]
    O --> D[Driver d’agent]
    D --> R[Codex, Claude Code, Kilo Code ou autre CLI]
    C[pipeline.config.json] --> O
    C --> D
    G[Commandes et gates] --> O
~~~

Les rôles sont volontairement étroits :

| Rôle | Responsabilité |
| --- | --- |
| **Orchestrator** | transitions, dispatch, persistance sûre, sérialisation et escalade |
| **Product** | critères, dépendances, réservation du périmètre et préparation de livraison |
| **Implementer** | preuve rouge, tests puis code correspondant aux critères |
| **QA** | validation déterministe et qualitative, sans écriture |

Les permissions doivent être imposées par la plateforme qui exécute l’agent. Un prompt qui interdit une écriture n’est pas une frontière de sécurité.

### Sudocode pour les issues, la pipeline pour l’exécution

[Sudocode](https://github.com/sudocode-ai/sudocode) est la source de vérité pour les titres, descriptions, priorités, tags et dépendances des issues et des specs. La pipeline conserve séparément ce que Sudocode ne modélise pas : phase fine, propriétaire, réservations de fichiers, critères vérifiés, preuves et journal des transitions.

Cette séparation est volontaire. Sudocode reconstruit ses fichiers JSONL depuis sa base locale et ne garantit pas la conservation de champs arbitraires. Placer `pipeline_state` directement dans `.sudocode/issues.jsonl` risquerait donc de perdre l’état d’exécution.

Le lien entre les deux stores est contrôlé par identifiant, UUID et empreinte du périmètre. Un changement de statut seul reste synchronisable ; un changement de titre, contenu, dépendances ou tags bloque le dispatch jusqu’à un rafraîchissement explicite. Après le début du travail, ce rafraîchissement exige l’approbation de l’opérateur afin qu’une édition d’issue ne puisse pas élargir silencieusement les specs.

## Agnostique par construction

Le cœur ne connaît ni Codex, ni Claude Code, ni Kilo Code. Il lance la commande déclarée dans `pipeline.config.json` et lui transmet un paquet portable :

~~~json
{
  "agent_runtime": {
    "prompt_adapter": "portable",
    "command": "votre-cli-agent",
    "args": [
      "vos-options",
      "Lis le paquet {package} et exécute le rôle {role}."
    ],
    "interactive_input": false,
    "progress_interval_seconds": 20
  }
}
~~~

Les substitutions disponibles sont :

- `{package}` : chemin absolu du paquet de dispatch ;
- `{role}` : rôle demandé ;

La commande est lancée directement, sans shell. Les arguments restent donc portables et ne permettent pas d’injecter une commande construite dynamiquement.

Deux adaptateurs de prompt sont fournis :

- `portable`, pour toute CLI acceptant une instruction et un chemin de paquet ;
- `claude-code`, pour la forme d’invocation propre à Claude Code.

Une autre CLI se branche par configuration, sans modification du moteur. Sa capacité à recevoir des messages pendant l’exécution dépend toutefois de sa propre interface.

## Observable et interruptible

Un dispatch se lance avec :

~~~bash
node agent-pipeline/scripts/dispatch.mjs <issue-id> <role>
~~~

Le driver annonce les étapes de préparation, le lancement du runtime, sa progression et sa fin. Avec `--json`, ces informations deviennent des événements NDJSON exploitables par une interface :

~~~bash
node agent-pipeline/scripts/dispatch.mjs <issue-id> <role> --json
~~~

Les événements distinguent notamment :

- le démarrage et l’interruption ;
- la sortie standard et la sortie d’erreur de l’agent ;
- le heartbeat périodique ;
- la fin et son code de sortie.

`Ctrl+C` est propagé au processus enfant. L’utilisateur n’est donc pas prisonnier d’une exécution silencieuse. Chaque lancement écrit aussi sous `agent_runtime.runs_dir` une preuve non sensible contenant le rôle, le digest du package, le PID, les horaires et le code de sortie ; la sortie complète reste en mémoire. Si la CLI choisie accepte réellement des messages sur son entrée standard pendant l’exécution, activez `agent_runtime.interactive_input: true` : le dashboard affiche alors un champ « Send » par agent et transmet le texte à ce processus précis. La valeur reste `false` par défaut, car prétendre qu’une CLI non interactive a reçu un message serait plus dangereux qu’un refus clair.

### Dashboard local en direct

Le dashboard consomme ce même flux sans introduire un second scheduler :

~~~bash
node agent-pipeline/dashboard/server.mjs
~~~

Ouvrez ensuite `http://127.0.0.1:4399`. La page lit la liste depuis Sudocode, la joint à l’état de contrôle de la pipeline, permet de rechercher et filtrer, puis calcule le rôle attendu depuis la phase. Une issue Sudocode pas encore préparée est visible mais non dispatchable ; une dérive de scope ou de statut expose sa correction au lieu de lancer un agent avec un brief périmé. Après sélection, la page permet de suivre le statut, le heartbeat, le temps et la sortie du rôle, d’envoyer une précision si le runtime est interactif, puis d’interrompre précisément son processus. Un autre port se choisit avec `--port <nombre>`.

Le serveur n’écoute que sur la boucle locale, protège les actions par un jeton aléatoire et lance les commandes sans shell. Il revérifie l'existence, la disponibilité et le rôle de l'issue au moment du dispatch, et refuse deux exécutions simultanées de la même issue. Les sorties restent en mémoire pendant la session du serveur : ce journal d’exécution n’est ni le store durable ni une nouvelle source de vérité.

Le framework peut également rester dans un dépôt voisin :

~~~bash
cd /chemin/du/projet
node ../agent-pipeline/dashboard/server.mjs
~~~

Pour Docker :

~~~bash
AGENT_PIPELINE_PROJECT="$PWD" \
  docker compose -f agent-pipeline/dashboard/compose.yaml up --build
~~~

Compose monte le projet dans `/workspace` et ne publie la page que sur `127.0.0.1:4399`. Le port hôte peut être remplacé avec `AGENT_PIPELINE_DASHBOARD_PORT`. L’image de base contient Node, Git et la pipeline, mais ni Sudocode, ni CLI d’agent, ni toolchain du projet : pour dispatcher réellement depuis le conteneur, elles doivent être ajoutées à une image dérivée avec leurs identifiants montés, jamais incorporés. Le guide complet est dans [dashboard/README.md](dashboard/README.md).

## Un périmètre qui converge

Dès qu’une issue quitte `planned`, ses critères et ses réservations deviennent le contrat actif. Une découverte ne rejoint pas automatiquement ce contrat.

Elle est classée dans l’une des routes suivantes :

| Route | Effet |
| --- | --- |
| `parking` | conservée pour plus tard, sans planification automatique |
| `criterion` | preuve concernant un critère existant |
| `regression` | défaut introduit par l’implémentation courante |
| `delivery_blocker` | empêche objectivement la livraison du périmètre convenu |
| `framework` | concerne la pipeline elle-même |

Consulter l’inbox virtuelle :

~~~bash
node agent-pipeline/scripts/findings.mjs --all
node agent-pipeline/scripts/findings.mjs --spec <spec-id>
node agent-pipeline/scripts/findings.mjs --all --json
~~~

Le parking ne devient jamais une file de travail implicite. Élargir les critères actifs exige une décision opérateur explicite de type `scope_change`. À partir de `ready_for_pr`, seul un `delivery_blocker` approuvé peut encore rejoindre la livraison ; le reste devient une nouvelle spec. Une spec `merged` est immuable.

Après le merge humain, la livraison est réconciliée avec le commit réellement présent dans Git :

~~~bash
node agent-pipeline/scripts/reconcile-merge.mjs <spec-id> \
  --sha <merge-commit> \
  --merged-at <date-ISO>
~~~

Tant que cette commande n’a pas réussi, une spec encore marquée `pr_open` n’est pas considérée comme terminée.

## Un coût proportionné au risque

Le workflow peut limiter le travail réalisé lors d’une seule invocation :

~~~json
{
  "workflow": {
    "max_transitions_per_run": 4,
    "gates": {
      "low": ["check", "lint", "test_unit"],
      "normal": ["check", "lint", "test_unit", "smoke"],
      "high": "all"
    }
  }
}
~~~

Une voie légère accélère le feedback intermédiaire. Elle ne réduit pas la définition de « terminé » : les gates omises doivent être rejouées avant la fermeture.

## Qualité frontend

Le bundle [profile-bundles/frontend-typescript](profile-bundles/frontend-typescript) définit un contrat de référence indépendant de React, Vue, Svelte ou Angular :

~~~bash
node agent-pipeline/scripts/import-profile.mjs \
  agent-pipeline/profile-bundles/frontend-typescript
~~~

Il exige des portes distinctes pour le typage strict, l’architecture et ses cycles, les tokens, l’accessibilité, les limites de conception, le code mort, la duplication, les tests navigateur, les régressions visuelles, le smoke test et la carte du projet.

Ce bundle ne prétend pas deviner la toolchain. Il déclare des noms de scripts npm stables que l’agent de bootstrap relie aux outils réellement retenus. Son drapeau `calibration_required` bloque l’application du profil jusqu’à ce que chaque commande existe, soit réglée sur le projet et ait échoué une fois sur un défaut volontaire.

La cohérence visuelle suit l’ordre `tokens → primitives → composants produit → mockup validé → écrans`. Cela refuse une interface incohérente ; cela ne garantit pas qu’elle soit belle ou distinctive, ce qui reste une décision produit et humaine.

## Installation

### Quick start avec Sudocode

~~~bash
npm install -g sudocode
cd /chemin/du/projet
sudocode init
sudocode server
~~~

La pipeline attend ensuite `issue_tracker.command: "sudocode"`. Une équipe qui préfère `npx` peut configurer `command: "npx"` et `args: ["--yes", "sudocode"]` ; le cœur ne dépend pas du mode d’installation, seulement d’une commande exécutable.

### Prérequis

- Node.js 20 ou supérieur ;
- Git ;
- un dépôt hôte ;
- la CLI [Sudocode](https://github.com/sudocode-ai/sudocode) pour la gestion des issues (`npm install -g sudocode`) ;
- au moins une CLI d’agent si vous souhaitez utiliser le dispatch automatique.

Le cœur n’a aucune dépendance npm de production.

### Installation par un agent — recommandée

Dans une session ouverte à la racine du nouveau projet, donnez cette seule instruction à Codex, Claude Code, Kilo Code ou un autre agent capable de travailler dans le dépôt :

~~~text
Installe et configure complètement agent-pipeline dans ce dépôt depuis
https://github.com/HerbertCodex/agent-pipeline.git.

Après le clone, lis intégralement agent-pipeline/docs/nouveau-profil.md et
exécute son parcours d’installation. Ne modifie pas le cœur placé dans
agent-pipeline/.

Commence par inspecter les manifests, la configuration et les sources. S’ils
prouvent une stack existante, utilise cette stack sans reprendre les commandes
d’un autre projet. Si le dépôt est vide ou si les preuves sont insuffisantes,
n’invente rien : demande-moi, dans un seul message court, quel produit nous
construisons, ses contraintes, et si la stack est imposée. Si elle ne l’est
pas, recommande une option principale avec ses compromis et attends mon
accord. Fais ensuite valider l’architecture. Persiste ces réponses dans la
configuration et le journal de décisions afin qu’aucun agent ne les redemande.

Tu peux créer la configuration, le profil, le contexte, les outils propres à
la stack, la carte du projet, le journal de décisions, le store de contrôle,
les hooks et la CI. Installe ou initialise Sudocode si nécessaire, configure
`issue_tracker`, et prouve que `tracker-sync` lit ses fichiers réels sans
mélanger son store avec celui de la pipeline. Termine uniquement lorsque les
contrôles du checkpoint final sont prouvés par leurs commandes.

En dehors de ce bootstrap conditionnel, ne m’interromps que pour autoriser une
nouvelle dépendance ou configurer une permission que seule la plateforme peut
imposer.
~~~

L’agent prend en charge le clone, l’identification ou la sélection guidée de la stack, la création de `pipeline.config.json`, la calibration des gates, la génération des cibles, l’initialisation de Sudocode et celle du store de contrôle séparé.

Pour un frontend TypeScript, il utilise le bundle de référence comme liste de contrôles, puis remplace chaque commande par l’outil réellement choisi pour le projet.

Cette installation reste agnostique : le parcours est décrit dans le dépôt et les contrôles sont des commandes Node. Aucun fournisseur d’agent particulier n’est imposé au bootstrap.

Les décisions suivantes ne sont volontairement pas inventées :

- le produit, ses contraintes et la stack lorsqu’ils ne sont pas déjà établis ;
- l’architecture retenue ;
- l’installation d’une nouvelle dépendance ;
- les permissions réelles accordées par la plateforme à chaque rôle.

### Installation manuelle — référence

Si aucun agent ne peut préparer le dépôt, commencez par intégrer le framework :

~~~bash
git clone https://github.com/HerbertCodex/agent-pipeline.git agent-pipeline
rm -rf agent-pipeline/.git
node --test agent-pipeline/test
~~~

La suppression du `.git` imbriqué fait de `agent-pipeline/` une partie versionnée du projet hôte. Un submodule reste possible si vous préférez gérer ses mises à jour séparément.

Le template de configuration est une base de chemins et de commandes fournies par le cœur, pas une configuration exécutable à copier telle quelle. Il faut créer le profil de stack, ajouter les gates obligatoires et adapter les permissions avant de lancer :

~~~bash
node agent-pipeline/scripts/apply-profile.mjs
node agent-pipeline/scripts/sync-briefs.mjs
node agent-pipeline/scripts/preflight.mjs
node agent-pipeline/scripts/install-hooks.mjs
~~~

Le parcours complet, y compris la calibration et les sept preuves finales, est dans [docs/nouveau-profil.md](docs/nouveau-profil.md).

## Utilisation quotidienne

### 0. Gérer le backlog dans Sudocode

Initialisez une fois le projet, puis lancez son interface lorsque vous voulez gérer les specs et les issues :

~~~bash
sudocode init
sudocode server
~~~

Les issues confiées à la pipeline portent le tag configuré, `agent-pipeline` par défaut. Product prépare ensuite leur contrat interne (critères et réservations) ; tant que ce contrôle n’existe pas, le dashboard les affiche comme « not imported » sans autoriser un dispatch d’implémentation.

Après chaque transition persistée, l’orchestrateur applique puis vérifie la projection du statut :

~~~bash
node agent-pipeline/scripts/tracker-sync.mjs --apply
node agent-pipeline/scripts/tracker-sync.mjs
~~~

La pipeline n’écrit jamais directement les JSONL de Sudocode : les mutations passent par sa CLI, avec un vecteur d’arguments et sans shell.

### 1. Voir la prochaine action

~~~bash
node agent-pipeline/scripts/next-step.mjs
~~~

Pour obtenir les issues dispatchables sans conflit de réservation :

~~~bash
node agent-pipeline/scripts/next-issues.mjs
~~~

### 2. Dispatcher un rôle

~~~bash
node agent-pipeline/scripts/dispatch.mjs <issue-id> product
node agent-pipeline/scripts/dispatch.mjs <issue-id> implementer
node agent-pipeline/scripts/dispatch.mjs <issue-id> qa
~~~

Le paquet contient le prompt rendu, le brief utile, l’état courant, sa version et son empreinte. Il évite de renvoyer toute l’histoire du projet à chaque agent.

### 3. Valider puis persister un handoff

Les rôles non orchestrateurs produisent un handoff JSON délimité. L’orchestrateur :

1. valide sa structure ;
2. le confronte au diff réel ;
3. persiste la transition avec verrou optimiste ;
4. projette le statut dans Sudocode via sa CLI ;
5. relit et vérifie les deux sources.

Commandes concernées :

~~~text
store-read.mjs
validate-handoff.mjs
verify-scope.mjs
store-update.mjs
store-verify.mjs
~~~

Les détails du protocole sont dans [docs/handoff-store.md](docs/handoff-store.md).

### 4. Traiter uniquement les décisions humaines

~~~bash
node agent-pipeline/scripts/render-decisions.mjs decisions.html
node agent-pipeline/scripts/render-spec.mjs spec.html <spec-id>
~~~

Ces pages statiques rendent les arbitrages et l’état final d’une spec visibles sans lire le store à la main. Le manuel [docs/operateur.md](docs/operateur.md) décrit les décisions qui restent humaines.

### 5. Mesurer le workflow

~~~bash
node agent-pipeline/scripts/metrics.mjs
~~~

Les métriques portent sur la mécanique de livraison : temps par phase, rejets, blocages, transitions et convergence. Elles ne prétendent pas mesurer seules la qualité du produit.

## Garanties importantes

### Preuve rouge avant correction

L’Implementer fournit une preuve reproductible que le test échoue sans le correctif, puis sépare le commit de test du commit de code. L’orchestrateur rejoue cette preuve avant le passage en QA.

### Budget de rejets QA

Un défaut de code trouvé par QA retourne à l’Implementer et doit être épinglé par un test rouge. Après le nombre maximal de rejets configuré pour la même issue, le workflow passe en escalade opérateur au lieu de boucler.

### Store à écrivain unique

Product, Implementer et QA ne modifient jamais directement le store. `store-update` applique un verrou global, vérifie l’empreinte et la version attendues, puis écrit atomiquement.

### Preuve par SHA

Une validation CI verte n’est réutilisable que pour le SHA exact qu’elle a testé. QA peut lire cette preuve au lieu de rejouer ce qui est déjà couvert, tout en exécutant les contrôles qualitatifs ou absents de la CI.

## Ce que le projet ne garantit pas

- Il ne choisit pas l’architecture, les dépendances ou les critères à votre place.
- Il n’installe pas les outils référencés par les commandes du profil.
- Il ne transforme pas un prompt en frontière de sécurité.
- Il ne prouve pas encore expérimentalement qu’il surpasse toute autre orchestration.
- Il ne remplace pas la revue humaine des surfaces sensibles ou des choix subjectifs.
- Il ne rend pas conversationnelle une CLI qui ne fournit aucune entrée interactive.

La pipeline garantit surtout que les décisions, preuves, transitions et exceptions deviennent visibles et contrôlables.

## Structure du dépôt

| Chemin | Contenu |
| --- | --- |
| `scripts/` | moteur, gates, génération, store, dispatch et observabilité |
| `dashboard/` | serveur local et interface de supervision en direct |
| `prompts/` | rôles génériques |
| `profile-bundles/` | contrats de stack réutilisables à recalibrer |
| `schemas/` | contrats machine du store, des règles et des handoffs |
| `templates/` | configuration, politique centrale et CI générée |
| `skills/` | conseils portables installés par profil |
| `docs/` | conception, protocoles et guides |
| `test/` | tests du framework |

Pour approfondir :

- [docs/state-machine.md](docs/state-machine.md) — machine d’état et responsabilités ;
- [docs/handoff-store.md](docs/handoff-store.md) — persistance et handoffs ;
- [docs/nouveau-profil.md](docs/nouveau-profil.md) — adaptation à une nouvelle stack ;
- [docs/quality-gates.md](docs/quality-gates.md) — preuves et portes de qualité ;
- [docs/etalonnage.md](docs/etalonnage.md) — protocole d’évaluation comparative.

## Licence

[MIT](LICENSE)
