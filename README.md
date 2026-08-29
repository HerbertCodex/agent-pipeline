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
    O --> P[Product]
    O --> I[Implementer]
    O --> Q[QA]
    P -->|handoff JSON| O
    I -->|handoff JSON| O
    Q -->|handoff JSON| O
    O --> S[(Store JSONL)]
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

`Ctrl+C` est propagé au processus enfant. L’utilisateur n’est donc pas prisonnier d’une exécution silencieuse. Pour rendre la session véritablement conversationnelle, le runtime choisi doit lui-même exposer une entrée interactive ; la pipeline ne simule pas cette capacité.

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

Le parking ne devient jamais une file de travail implicite. Élargir les critères actifs exige une décision opérateur explicite de type `scope_change`.

## Un coût proportionné au risque

Le workflow peut limiter le travail réalisé lors d’une seule invocation :

~~~json
{
  "workflow": {
    "max_transitions_per_run": 4,
    "risk_lanes": {
      "low": ["check", "lint", "test_unit"],
      "normal": ["check", "lint", "test_unit", "smoke"],
      "high": ["all"]
    }
  }
}
~~~

Une voie légère accélère le feedback intermédiaire. Elle ne réduit pas la définition de « terminé » : les gates omises doivent être rejouées avant la fermeture.

## Installation

### Prérequis

- Node.js 20 ou supérieur ;
- Git ;
- un dépôt hôte ;
- au moins une CLI d’agent si vous souhaitez utiliser le dispatch automatique.

Le cœur n’a aucune dépendance npm de production.

### Ajouter la pipeline à un projet

Depuis la racine du dépôt hôte :

~~~bash
git clone https://github.com/HerbertCodex/agent-pipeline.git agent-pipeline
rm -rf agent-pipeline/.git
node --test agent-pipeline/test
~~~

La suppression du `.git` imbriqué fait de `agent-pipeline/` une partie versionnée du projet hôte. Si vous préférez un submodule ou un autre mécanisme de distribution, conservez l’historique séparé et adaptez votre politique de mise à jour.

### Configurer le profil

1. Copiez `templates/pipeline.config.template.json` vers `pipeline.config.json`.
2. Choisissez ou créez un profil dans `profiles/`.
3. Renseignez les commandes réelles du projet, les chemins autorisés et le runtime d’agent.
4. Générez les fichiers dérivés.

~~~bash
node agent-pipeline/scripts/apply-profile.mjs
node agent-pipeline/scripts/sync-briefs.mjs
node agent-pipeline/scripts/preflight.mjs
~~~

Installez ensuite les hooks de contrôle :

~~~bash
node agent-pipeline/scripts/install-hooks.mjs
~~~

Les modes `--check` permettent à la CI de refuser toute dérive :

~~~bash
node agent-pipeline/scripts/apply-profile.mjs --check
node agent-pipeline/scripts/sync-briefs.mjs --check
node agent-pipeline/scripts/install-hooks.mjs --check
~~~

Le guide complet de création d’un profil est dans [docs/nouveau-profil.md](docs/nouveau-profil.md).

## Utilisation quotidienne

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
4. relit et vérifie le store.

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
| `prompts/` | rôles génériques |
| `profiles/` | règles et extensions propres aux stacks |
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
