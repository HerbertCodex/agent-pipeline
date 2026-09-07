# agent-pipeline

Une pipeline vérifiable pour faire travailler des agents de développement, sans dépendre d’un fournisseur d’agent.

[Read in English](README.md)

Le projet transforme le développement multi-agent en workflow observable et borné : rôles séparés, état durable, critères gelés, commandes de qualité exécutables et preuves liées aux commits.

> Une règle importante doit pouvoir échouer dans une commande. Sinon, c’est un conseil.

![Le dashboard agent-pipeline en direct avec les issues et leur état de dispatch](docs/assets/dashboard.png)

## Ce que le projet apporte

| Risque | Réponse |
| --- | --- |
| Agents qui se marchent dessus | réservations de fichiers et détection d’intersection |
| Périmètre qui grandit | critères figés, découvertes garées, expansion approuvée seulement |
| « terminé » subjectif | transitions contrôlées, gates et preuves par SHA |
| État modifié par plusieurs rôles | store à écrivain unique et verrou optimiste |
| Agents silencieux | événements NDJSON, heartbeat, dashboard et interruption |

## Installer dans un projet déjà avancé (toutes stacks)

Depuis la racine de votre projet, donnez le prompt ci-dessous à votre agent. Il privilégie les outils et l’architecture existants, quelle que soit la stack : Spring Boot, AdonisJS, NestJS ou autre. Il guide l’adaptation du profil ; ce n’est pas un installateur universel automatique. Un adaptateur compatible reste un raccourci facultatif.

Voir aussi le [guide et le prompt en anglais](docs/existing-project.md).

<details>
<summary>Afficher le prompt d’installation à copier</summary>

```text
Installe et configure Agent Pipeline dans ce projet existant, en respectant son architecture, ses conventions et ses outils.

L’objectif est d’encadrer les prochaines fonctionnalités et corrections. Cette tâche ne comprend ni refonte du projet ni développement fonctionnel.

Commence par lire les instructions du dépôt, puis inspecte :
- les langages, frameworks et versions réellement utilisés ;
- la structure du projet et ses éventuels modules ou workspaces ;
- les commandes existantes de compilation, tests, lint et autres contrôles ;
- la CI, les conventions et la documentation d’architecture ;
- l’état Git et les modifications locales à préserver.

Appuie-toi sur les fichiers observés. Ne suppose pas que le projet utilise NestJS et ne cherche pas à lui imposer un modèle de projet neuf.

Lis ensuite la documentation et les scripts de la version d’Agent Pipeline présente. Si elle n’est pas installée, ajoute le dépôt officiel en suivant sa procédure documentée d’installation et de sélection de version :
https://github.com/HerbertCodex/agent-pipeline

Utilise le parcours d’initialisation réellement disponible :
- réutilise un profil compatible lorsqu’il correspond au projet ;
- sinon, configure le profil du projet à partir de ses outils existants ;
- ne crée pas un adaptateur de framework complet pour cette seule installation ;
- ne modifie pas le cœur d’Agent Pipeline pour contourner une incompatibilité ;
- si une pipeline est déjà installée, inspecte-la et utilise son parcours de mise à jour ou de migration avant d’envisager une nouvelle initialisation.

Privilégie les commandes déjà définies dans les scripts du projet, ses wrappers et sa CI. Réutilise les outils existants avant d’en créer de nouveaux. Génère les fichiers communs avec les scripts de la pipeline ; ne compose pas manuellement les fichiers qu’ils savent générer.

Préserve les sources, les tests, les dépendances, les instructions des agents et la CI existante. Examine les conflits avant modification. Demande une décision uniquement lorsqu’un choix important ne peut pas être déduit du dépôt, notamment pour ajouter une dépendance ou remplacer une configuration.

Établis un état initial des contrôles :
- commandes exécutées et durées ;
- contrôles réussis ;
- défauts préexistants ;
- contrôles indisponibles ou restant à configurer.

Ne masque aucun échec, ne réduis aucun seuil et ne remplace aucun contrôle par une commande qui réussit sans vérifier. Ne lance pas plusieurs fois une vérification coûteuse si aucun changement ou échec non résolu ne justifie de la rejouer. Note la révision et les modifications locales pertinentes associées à cet état initial.

Si la pipeline exige un contrôle que le projet ne possède pas, explique précisément ce qui manque. Ne présente pas l’installation comme terminée tant qu’un prérequis obligatoire reste insatisfait. N’élargis pas cette installation à la correction de toute la dette historique.

Configure les permissions et les réservations selon les chemins réels du projet. Prévois l’isolation des tentatives et la conservation des preuves conformément aux capacités disponibles.

Termine par :
1. Les fichiers créés ou modifiés et leur rôle.
2. Les résultats des vérifications et les limites restantes.
3. Les commandes exactes pour démarrer la pipeline et son dashboard.
4. Les éventuelles décisions nécessaires avant la première tâche.

N’importe pas automatiquement toute la dette technique dans le backlog. Ne lance aucun agent de développement, ne crée aucune fonctionnalité et ne fais aucun commit, merge ou push pendant cette installation.
```

</details>

## Installation automatique dans un projet Nest existant

Depuis la racine du projet créé avec `nest new`, avec ses dépendances installées, Git, Sudocode et ce checkout de développement dans `agent-pipeline/` :

```sh
node agent-pipeline/scripts/setup.mjs --runtime claude-code
```

La commande détecte les outils existants, installe le profil fourni, génère la configuration, les rôles et les briefs, initialise le tracker, installe les hooks et vérifie les contrôles réels. Elle conserve les sources, les scripts du projet et les dépendances. Aucun agent n’a besoin de composer les fichiers d’installation.

`--dry-run` affiche le plan sans écrire. Les versions installées doivent respecter le [manifeste de compatibilité](profile-bundles/nest/compatibility.json), actuellement validé pour Nest 11 avec Node 24, npm 11, Jest 30 et ESLint 9. Les monorepos et les combinaisons non validées restent à adapter. `pipeline/setup-report.json` contient les étapes et leurs durées.

Pour faire évoluer un adaptateur installé, `setup.mjs --update` affiche les changements et `setup.mjs --update --apply` les applique avec vérification, en conservant les adaptations locales compatibles. La CI teste le contrat déclaré et surveille chaque semaine la dernière CLI publiée. Voir [le parcours Nest et ses limites](profile-bundles/nest/README.md).

Cette commande est nouvelle dans le checkout de développement et n’est pas incluse dans la version `v0.1.0` ci-dessous.

## Installation versionnée et adaptation manuelle

```sh
git submodule add https://github.com/HerbertCodex/agent-pipeline.git agent-pipeline
git -C agent-pipeline checkout v0.1.0
git add .gitmodules agent-pipeline
node agent-pipeline/scripts/init.mjs
```

`init.mjs` enregistre le produit, les contraintes, la stack imposée ou non et l’architecture approuvée. Ces réponses deviennent un fichier de bootstrap, une décision et une configuration volontairement incomplète. L’installation de la stack inspecte ensuite les sources réelles et calibre les commandes. Consultez [le parcours complet](docs/nouveau-profil.md) et [la politique de versions](docs/releases.md).

Le cœur nécessite Node.js 20+, Git et aucune dépendance npm de production. Sudocode fournit le parcours tracker complet ; l’adaptateur minimal GitHub Issues nécessite une CLI `gh` authentifiée.

L’installation initiale inclut la préparation et la calibration des outils de la stack. Pour réutiliser un profil existant, lancez `import-profile.mjs <bundle-dir>` après `init.mjs` : la configuration initiale est complétée automatiquement en conservant vos décisions. Le profil TypeScript fourni reste un contrat à adapter, pas une stack prête à lancer.

Pour une présentation avec Nest, préparez le projet, ses dépendances et Sudocode ; vous pouvez ensuite montrer la commande `setup.mjs` elle-même. Pour diagnostiquer les contrôles d’une installation existante, `preflight.mjs --timeout-seconds 60` affiche la progression et les durées, avec une limite par commande. Voir [le coût d’installation et les démonstrations](docs/nouveau-profil.md#installation-cost-and-live-demonstrations).

## Utilisation

```sh
node agent-pipeline/scripts/next-step.mjs
node agent-pipeline/scripts/next-issues.mjs
node agent-pipeline/scripts/dispatch.mjs <issue-id> implementer
node agent-pipeline/scripts/tracker-sync.mjs --apply
node agent-pipeline/scripts/tracker-sync.mjs
```

Le dashboard local démarre avec `node agent-pipeline/dashboard/server.mjs` et s’ouvre sur `http://127.0.0.1:4399`.

## Trackers et sécurité

Sudocode prend en charge issues, specs, relations, création idempotente et statuts. L’adaptateur GitHub lit les issues via `gh`, distingue les specs par label et projette les phases par labels. Il refuse explicitement la création et les relations automatisées, qui n’ont pas de contrat portable équivalent.

`file_policy` prévient une écriture uniquement si la plateforme impose réellement des permissions par rôle. Sinon, la pipeline assure une **détection, pas une prévention** : `verify-scope` confronte le diff aux réservations et refuse la transition après le retour de l’agent. Une véritable prévention exige des identités ou sandboxes séparées.

## Stack et données

Les profils relient les gates aux vrais outils de la stack. Aucun framework applicatif n’est imposé. Pour une base relationnelle, `data_model` rend explicites schéma, migrations, tests d’intégration, cible 3NF et politique UTC des horodatages. Le diagramme UML autonome se génère avec `render-data-model.mjs`.

## Limites

La pipeline rend décisions, preuves, transitions et exceptions contrôlables. Elle ne choisit pas le produit ou l’architecture, ne remplace pas la revue humaine, ne transforme pas un prompt en permission et ne rend pas interactive une CLI qui ne l’est pas.

## Documentation

- [Installation d’un nouveau projet](docs/nouveau-profil.md)
- [Manuel opérateur](docs/operateur.md)
- [Machine d’état](docs/state-machine.md)
- [Handoffs et store](docs/handoff-store.md)
- [Gates de qualité](docs/quality-gates.md)
- [Versions et mises à jour](docs/releases.md)

## Licence

[MIT](LICENSE)

[Isolation des exécutions, preuves conservées et réutilisation de la CI](docs/execution-maintenance.md).
