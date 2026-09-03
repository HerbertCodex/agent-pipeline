# agent-pipeline

Une pipeline vérifiable pour faire travailler des agents de développement sur un dépôt, sans dépendre d’un fournisseur d’agent.

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Core dependencies](https://img.shields.io/badge/core_dependencies-0-blue)](#prérequis)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Elle transforme un développement multi-agent en workflow observable et borné : des rôles séparés, un état durable, des critères gelés, des commandes de qualité exécutables et des preuves attachées aux commits.

> Une règle importante doit pouvoir échouer dans une commande. Une consigne présente uniquement dans un prompt reste un conseil.

## Ce que le projet apporte

| Risque habituel | Réponse de la pipeline |
| --- | --- |
| Agents qui se marchent dessus | réservations de fichiers et détection d’intersection |
| Périmètre qui grandit pendant le travail | critères figés, découvertes garées, expansion approuvée seulement |
| « terminé » subjectif | transitions contrôlées, gates et preuves par SHA |
| État modifié par plusieurs rôles | store durable à écrivain unique et verrou optimiste |
| Agents silencieux ou bloqués | événements NDJSON, heartbeat, dashboard local et interruption |
| Validation trop coûteuse | voies de risque et gates de clôture explicites |

~~~mermaid
flowchart LR
    U[Opérateur] --> O[Orchestrator]
    U --> S[Sudocode]
    S --> O
    O --> P[Product]
    O --> I[Implementer]
    O --> Q[QA]
    P -->|handoff JSON| O
    I -->|handoff JSON| O
    Q -->|handoff JSON| O
    O --> C[(Control store)]
    O --> R[CLI d’agent]
~~~

Les rôles restent volontairement étroits : Product définit le travail, Implementer écrit les tests et le code, QA valide sans écrire, Orchestrator contrôle les transitions et le store. Les permissions doivent être imposées par la plateforme : un prompt n’est pas une frontière de sécurité.

## Démarrer dans un projet

### Avec un agent — recommandé

Dans le dépôt cible, donnez cette instruction à Codex, Claude Code, Kilo Code ou toute CLI capable de modifier le projet :

~~~text
Installe et configure complètement agent-pipeline dans ce dépôt depuis
https://github.com/HerbertCodex/agent-pipeline.git.

Lis intégralement agent-pipeline/docs/nouveau-profil.md et suis son parcours.
Ne modifie pas le cœur dans agent-pipeline/. Commence par inspecter manifests,
configuration et sources : utilise la stack prouvée. Si le dépôt est vide ou
ambigu, demande quel produit construire, ses contraintes et si la stack est
imposée ; recommande une option et attends la validation de l’architecture.

Persiste les décisions dans la configuration et le journal de décisions.
Initialise Sudocode si nécessaire, configure issue_tracker avec un store de
contrôle distinct, puis ne termine qu’après les contrôles du checkpoint final.
~~~

Le guide de bootstrap couvre l’identification de la stack, la calibration des gates, les profils, les hooks, la CI éventuelle et les preuves finales : [docs/nouveau-profil.md](docs/nouveau-profil.md).

### Prérequis

- Node.js 20 ou supérieur ;
- Git ;
- un dépôt hôte ;
- [Sudocode](https://github.com/sudocode-ai/sudocode) pour gérer issues et specs ;
- une CLI d’agent seulement si vous utilisez le dispatch automatique.

Le cœur n’a aucune dépendance npm de production.

### Installation manuelle

~~~bash
git clone https://github.com/HerbertCodex/agent-pipeline.git agent-pipeline
rm -rf agent-pipeline/.git
node --test agent-pipeline/test/*.test.mjs
~~~

Intégrez ensuite un profil et ses commandes adaptées à votre stack ; ne copiez pas le template de configuration tel quel. Le [guide de nouveau profil](docs/nouveau-profil.md) est la procédure de référence.

## Utilisation quotidienne

Sudocode est la source de vérité pour les issues et les specs. La pipeline garde séparément les phases fines, réservations, critères, preuves et transitions : elle ne modifie jamais directement les JSONL de Sudocode.

~~~bash
# Voir la prochaine action et les issues sans conflit
node agent-pipeline/scripts/next-step.mjs
node agent-pipeline/scripts/next-issues.mjs

# Lancer un rôle
node agent-pipeline/scripts/dispatch.mjs <issue-id> product
node agent-pipeline/scripts/dispatch.mjs <issue-id> implementer
node agent-pipeline/scripts/dispatch.mjs <issue-id> qa

# Synchroniser et vérifier le tracker après une transition
node agent-pipeline/scripts/tracker-sync.mjs --apply
node agent-pipeline/scripts/tracker-sync.mjs
~~~

Le dashboard local rend ces mêmes données visibles en direct :

~~~bash
node agent-pipeline/dashboard/server.mjs
~~~

Ouvrez `http://127.0.0.1:4399`. Il reste sur la boucle locale et ne crée pas une seconde source de vérité. Consultez [dashboard/README.md](dashboard/README.md) pour Docker et les détails de sécurité.

## Adaptable à la stack et au runtime

Le cœur ne connaît ni Codex, ni Claude Code, ni un framework applicatif. `pipeline.config.json` déclare les commandes de qualité, le profil de stack, le tracker, le store et éventuellement la CLI d’agent. Les adaptateurs de prompt fournis sont `portable` et `claude-code`; une autre CLI se branche sans modifier le moteur.

Les profils font des règles des commandes concrètes : typage, lint, tests, audit, secrets, architecture, duplication, carte générée du projet et limites de conception. Le bundle [frontend-typescript](profile-bundles/frontend-typescript) est un exemple à recalibrer, pas une stack imposée.

### Données relationnelles et diagramme UML

Un projet propriétaire d’une base relationnelle peut déclarer `data_model` : décision de persistance, modèle, schéma physique, migrations, tests d’intégration, 3NF par défaut et politique UTC pour `created_at` / `updated_at`. Les exceptions restent explicites et documentées.

La pipeline ne prétend pas parser chaque dialecte SQL ou ORM ; le schéma physique reste la source technique de vérité. Pour une revue humaine, rendez la projection tables/champs/relations dans une page HTML UML autonome :

~~~bash
node agent-pipeline/scripts/render-data-model.mjs \
  docs/data-model.diagram.json data-model.html
~~~

Le format JSON complet est documenté dans [docs/nouveau-profil.md](docs/nouveau-profil.md#relational-data-only-when-the-project-owns-it).

## Ce que la pipeline garantit — et non

Elle rend visibles et contrôlables les décisions, preuves, transitions et exceptions. Elle ne choisit pas le produit, l’architecture ou les dépendances à votre place ; ne remplace pas la revue humaine ; ne transforme pas un prompt en permission ; et ne rend pas interactive une CLI qui ne l’est pas.

## Documentation

| Guide | Contenu |
| --- | --- |
| [Nouveau profil](docs/nouveau-profil.md) | installation et adaptation à une stack |
| [Manuel opérateur](docs/operateur.md) | décisions humaines et exploitation |
| [Machine d’état](docs/state-machine.md) | phases, rôles et transitions |
| [Handoffs et store](docs/handoff-store.md) | protocole de persistance et preuves |
| [Gates de qualité](docs/quality-gates.md) | règles qui deviennent des commandes |
| [Étalonnage](docs/etalonnage.md) | évaluation comparative de la pipeline |

## Développement

~~~bash
node --test test/*.test.mjs
~~~

Le dépôt est volontairement sans dépendance de production. Les contributions qui touchent prompts, scripts, configuration, règles ou profils passent par revue humaine.

## Licence

[MIT](LICENSE)
