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

## Démarrer dans un dossier vide

Lancez votre agent dans le dossier vide destiné au projet et donnez-lui ce prompt. Des métadonnées cachées comme `.agents/` ou `.codex/` peuvent déjà être présentes ; elles ne constituent pas un projet applicatif.

<details>
<summary>Afficher le prompt pour dossier vide</summary>

```text
Initialise une nouvelle application et installe Agent Pipeline dans ce dossier.

Ce dossier est volontairement vide. Tu es autorisé à y créer le dépôt Git, le
squelette de l’application et la pipeline. Ne refuse pas la tâche simplement parce
qu’aucun projet n’existe encore et ne sélectionne ni ne modifie un dépôt voisin.
Considère les métadonnées comme .agents/ et .codex/ comme des contrôles de l’espace
de travail, pas comme la preuve d’une stack applicative.

Avant d’écrire, confirme le dossier courant et inspecte son contenu. Réutilise
uniquement les choix explicitement fournis avec cette demande concernant le produit,
la stack, les versions, le gestionnaire de paquets, la structure du dépôt et le
runtime d’agent. Ne déduis jamais le produit du nom du dossier et n’invente pas une
coquille d’application générique.

Si l’objectif du produit n’a pas été fourni, ta prochaine action doit être de me
demander ce que je veux construire, qui l’utilisera et quelles contraintes
essentielles s’appliquent. Attends ma réponse avant de recommander une stack ou une
architecture. Identifie ensuite les décisions restantes et pose des questions
ciblées dans leur ordre de dépendance : produit, stack imposée ou choix de stack,
structure du dépôt, architecture, runtime d’agent, tracker et CI. Utilise l’outil de
questions interactives de la plateforme lorsqu’il est disponible. Appuie chaque
recommandation sur mes réponses précédentes et explique sa conséquence pratique.
Attends les réponses obligatoires avant d’écrire. Ne présente pas une configuration
complète construite sur des suppositions pour demander une approbation globale. Je
ne dois pas envoyer un autre prompt pour déclencher ces questions.

Avant de recommander les versions exactes des runtimes, frameworks ou outils,
consulte leurs prérequis officiels et les manifests de compatibilité applicables
d’Agent Pipeline. Ne recommande jamais une combinaison déjà déclarée incompatible.
Ne choisis pas silencieusement NestJS ni aucun autre framework.

Une fois ces choix réglés :

1. Initialise Git dans ce dossier si nécessaire.
2. Consulte la documentation officielle de la stack choisie et génère directement
   ici son squelette officiel minimal. N’implémente aucune fonctionnalité produit.
   Note le générateur exact et les versions résolues.
3. Exécute une fois les vraies commandes de build, types, lint et tests du squelette.
   Conserve leurs résultats et leurs durées comme état initial de l’application.
4. Ajoute le dépôt officiel Agent Pipeline avec sa procédure documentée,
   versionnée et actualisable :
   https://github.com/HerbertCodex/agent-pipeline
5. Lis intégralement son README, docs/releases.md et docs/nouveau-profil.md. Examine
   tout manifeste de compatibilité fourni avant de choisir un adaptateur exécutable.
6. Exécute init.mjs et enregistre les décisions approuvées sur le produit, la stack
   et l’architecture.
7. Réutilise un adaptateur exécutable compatible lorsque le projet généré respecte
   son contrat déclaré. Sinon, configure un profil propre au projet à partir des
   vraies commandes du squelette ; ne crée pas d’adaptateur universel et ne modifie
   pas le cœur d’Agent Pipeline pour contourner une incompatibilité. Pour un
   frontend TypeScript, matérialise d’abord le contrat générique fourni afin de
   produire un candidat propre aux technologies détectées.
8. Configure les invariants vérifiables, les permissions des rôles, les réservations,
   la carte du projet, le tracker, la CI, l’isolation des tentatives et la conservation
   des preuves. Génère les règles, prompts, briefs et hooks communs avec les scripts
   de la pipeline.
9. Exécute chaque contrôle obligatoire, conserve sa durée et sa sortie, prouve que
   chaque nouvelle porte peut échouer avec un cas isolé et réversible, restaure ce
   cas puis rejoue le contrôle concerné. Ne réduis aucun seuil et n’utilise aucune
   commande factice.

Si le dernier squelette officiel ne respecte pas le contrat d’un adaptateur publié,
présente l’écart exact et demande s’il faut utiliser une version supportée ou
continuer avec un profil propre au projet. N’annonce pas la fin de l’installation
tant qu’une dépendance, un outil, une décision ou un contrôle obligatoire manque.

Termine par :

1. Les décisions appliquées et les versions exactes choisies.
2. Les fichiers créés ou modifiés et leur rôle.
3. Les commandes initiales, leurs durées, leurs résultats et les preuves négatives.
4. Les limites ou décisions restantes.
5. Les commandes exactes pour démarrer la pipeline et le dashboard.

Ne crée pas la première spec produit, ne lance aucun agent de développement,
n’implémente aucune fonctionnalité et ne fais aucun commit, merge ou push pendant
cette initialisation.
```

</details>

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

`--dry-run` affiche le plan sans écrire. Les versions installées doivent respecter le [manifeste de compatibilité](profile-bundles/nest/compatibility.json), actuellement validé pour Nest 11 avec Node 22, npm 11, Jest 30 et ESLint 9. Node 24 est exclu tant que la dépendance SQLite native du tracker y interrompt le processus. Nest 12 reste surveillé, mais son projet officiel actuel échoue encore à l’audit des dépendances de sévérité haute. Les monorepos et les autres combinaisons non validées restent à adapter. `pipeline/setup-report.json` contient les étapes et leurs durées.

Pour faire évoluer un adaptateur installé, `setup.mjs --update` affiche les changements et `setup.mjs --update --apply` les applique avec vérification, en conservant les adaptations locales compatibles. La CI teste le contrat déclaré et surveille chaque semaine la dernière CLI publiée. Voir [le parcours Nest et ses limites](profile-bundles/nest/README.md).

Cette commande est incluse à partir de la version `v0.2.0`.

## Installation versionnée et adaptation manuelle

```sh
git submodule add https://github.com/HerbertCodex/agent-pipeline.git agent-pipeline
git -C agent-pipeline checkout v0.2.0
git add .gitmodules agent-pipeline
node agent-pipeline/scripts/init.mjs
```

`init.mjs` enregistre le produit, les contraintes, la stack imposée ou non et l’architecture approuvée. Ces réponses deviennent un fichier de bootstrap, une décision et une configuration volontairement incomplète. L’installation de la stack inspecte ensuite les sources réelles et calibre les commandes. Consultez [le parcours complet](docs/nouveau-profil.md) et [la politique de versions](docs/releases.md).

### Prompt pour configurer un nouveau projet

Après avoir créé le dépôt ou le squelette de l’application, ajouté Agent Pipeline et exécuté `init.mjs`, lancez votre agent depuis la racine du projet avec ce prompt. Remplacez `<stack>` par la stack choisie.

<details>
<summary>Afficher le prompt à copier</summary>

```text
Ce nouveau projet contient Agent Pipeline dans agent-pipeline/. Le bootstrap du
produit et de l’architecture a été enregistré avec init.mjs. La stack choisie est
<stack>.

Configure Agent Pipeline pour ce projet. Cette tâche installe le cadre de travail ;
elle ne comprend ni la première fonctionnalité, ni la création d’une spec produit.

Commence par lire intégralement :
- pipeline.bootstrap.json et docs/decisions/0000-bootstrap.md ;
- agent-pipeline/docs/nouveau-profil.md ;
- agent-pipeline/docs/releases.md ;
- les manifests, wrappers, sources et instructions déjà présents dans le projet.

Respecte les décisions du bootstrap. Ne change pas la stack ou l’architecture sans
me soumettre la décision. Ne suppose pas que le projet utilise NestJS. Un adaptateur
compatible est un raccourci facultatif ; n’écris pas un adaptateur de framework
complet pour cette seule installation.

Si un profil compatible existe, importe-le puis calibre-le sur ce projet. Sinon,
crée un profil propre au projet à partir des vrais outils de la stack. Privilégie
les commandes fournies par les scripts, wrappers et manifests du projet. Ne modifie
pas le cœur dans agent-pipeline/ pour contourner une incompatibilité. Pour un
frontend TypeScript, utilise d’abord la commande `materialize.mjs` du profil
générique afin de générer le candidat propre à la stack réellement détectée.

Configure au minimum les commandes, les invariants vérifiables, les permissions par
rôle, les réservations, l’architecture, la carte du projet, le tracker, la CI,
l’isolation des tentatives et la conservation des preuves. Génère AGENTS.md, les
prompts, les briefs, les règles et les hooks avec les scripts de la pipeline ; ne
modifie pas séparément une cible générée.

Si le projet expose une application web ou une API, lis
agent-pipeline/docs/security-testing.md. Inspecte l’environnement de test existant,
le healthcheck, l’authentification, la création des comptes, les définitions d’API
et les effets externes. Pose-moi des questions ciblées pour les décisions que le
dépôt ne permet pas d’établir. Ne devine ni identifiant, ni cible, ni autorisation
de scan actif. Applique ensuite la configuration relue avec configure-security.mjs.

Le générateur de carte du projet doit lire les extensions et exports réels de cette
stack. Une carte vide ou un contrôle qui réussit sans avoir inspecté de source ne
constitue pas une preuve.

Pour chaque contrôle obligatoire :
- exécute-le sur le projet réel et conserve sa durée et sa sortie ;
- prouve qu’il peut échouer avec un cas négatif isolé et réversible ;
- restaure ce cas, puis vérifie le résultat positif ;
- ne réduis aucun seuil et ne remplace aucun contrôle par une commande factice.

Si une dépendance, un outil externe ou une décision humaine manque, présente le
besoin précis et arrête uniquement l’étape concernée. N’annonce pas l’installation
comme terminée tant qu’un contrôle obligatoire reste absent ou non calibré.

Avant de terminer, exécute les contrôles finaux décrits dans
agent-pipeline/docs/nouveau-profil.md : cohérence des cibles générées, couverture
réelle de la carte, preuves négatives des portes, hooks, store et correspondance
entre chaque invariant et une commande qui peut le refuser.

Termine par :
1. Les fichiers créés ou modifiés et leur rôle.
2. Les commandes exécutées, leurs durées et leurs résultats.
3. Les preuves négatives réalisées.
4. Les prérequis ou décisions encore nécessaires.
5. Les commandes exactes pour créer la première spec et ouvrir le dashboard.

Ne lance aucun agent de développement, n’implémente aucune fonctionnalité, ne crée
pas de dette technique dans le backlog et ne fais aucun commit, merge ou push durant
cette installation.
```

</details>

Le cœur nécessite Node.js 20+, Git et aucune dépendance npm de production. Sudocode fournit le parcours tracker complet ; l’adaptateur minimal GitHub Issues nécessite une CLI `gh` authentifiée. Docker n’est requis que lorsqu’un projet configure les contrôles ZAP optionnels.

L’installation initiale inclut la préparation et la calibration des outils de la stack. Pour réutiliser un profil existant, lancez `import-profile.mjs <bundle-dir>` après `init.mjs` : la configuration initiale est complétée automatiquement en conservant vos décisions. Pour un frontend TypeScript, `profile-bundles/frontend-typescript/materialize.mjs <dossier-sortie>` crée d’abord un candidat propre aux technologies et aux scripts réellement détectés. Ce candidat doit encore être complété et calibré.

Pour une présentation avec Nest, préparez le projet, ses dépendances et Sudocode ; vous pouvez ensuite montrer la commande `setup.mjs` elle-même. Pour diagnostiquer les contrôles d’une installation existante, `preflight.mjs --timeout-seconds 60` affiche la progression et les durées, avec une limite par commande. Voir [le coût d’installation et les démonstrations](docs/nouveau-profil.md#installation-cost-and-live-demonstrations).

## Utilisation

```sh
node agent-pipeline/scripts/next-step.mjs
node agent-pipeline/scripts/next-issues.mjs
node agent-pipeline/scripts/transition.mjs <issue-id> implementer
node agent-pipeline/scripts/dispatch.mjs <issue-id> implementer
node agent-pipeline/scripts/tracker-sync.mjs --apply
node agent-pipeline/scripts/tracker-sync.mjs
```

**Le mouvement vient d’abord, et il est commité avant le dispatch.** Une phase
que l’orchestrateur tient — `planned` avant l’implémenteur, `ready_for_qa` avant
QA — est une phase où rien n’a commencé. Dispatcher sans la déplacer laisse le
paquet de tâche bâti sur cette fiche : l’agent y calcule son `basis`, et le
mouvement dû ensuite l’invalide, l’issue est bloquée. `dispatch` refuse une
telle phase et nomme la commande ; `next-step` imprime les deux, dans l’ordre.

Le dashboard local démarre avec `node agent-pipeline/dashboard/server.mjs` et s’ouvre sur `http://127.0.0.1:4399`.

## Trackers et sécurité

Sudocode prend en charge issues, specs, relations, création idempotente et statuts. L’adaptateur GitHub lit les issues via `gh`, distingue les specs par label et projette les phases par labels. Il refuse explicitement la création et les relations automatisées, qui n’ont pas de contrat portable équivalent.

`file_policy` prévient une écriture uniquement si la plateforme impose réellement des permissions par rôle. Sinon, la pipeline assure une **détection, pas une prévention** : `verify-scope` confronte le diff aux réservations et refuse la transition après le retour de l’agent. Une véritable prévention exige des identités ou sandboxes séparées.

## Tests dynamiques de sécurité et de charge

Un projet web peut configurer ZAP après l’installation de son profil :

```sh
node agent-pipeline/scripts/configure-security.mjs reviewed-security-config.json
node agent-pipeline/scripts/apply-profile.mjs
node agent-pipeline/scripts/security-scan.mjs check
node agent-pipeline/scripts/security-scan.mjs baseline
```

Le contrat définit l’environnement jetable, les cibles exactes, les comptes de
test fournis par variables d’environnement, la preuve d’authentification, l’image
ZAP immuable, les limites de durée et la matrice OWASP Top 10 2025. Tous les scans
refusent les données persistantes et les effets externes. Les tests de charge utilisent un outil et
un gate séparés. Les contrôles coûteux sont différés à la fermeture, planifiés ou
déclenchés manuellement. Consultez [le guide complet](docs/security-testing.md).

Pour un projet utilisant déjà une ancienne version d’Agent Pipeline, donnez
directement à l’agent le
[prompt copiable de migration et de sécurité](docs/security-testing.md#copyable-prompt-for-an-existing-installation).

## Stack et données

Les profils relient les gates aux vrais outils de la stack. Aucun framework applicatif n’est imposé. Pour une base relationnelle, la [gouvernance de base de données v2](docs/database-governance.md) contrôle clés et dépendances, normalisation, horodatages UTC, audit append-only, ownership, filtres et index, budgets mesurés, migrations, sécurité et restauration. Elle reste indépendante de l’ORM et préserve les anciennes installations.

```sh
node agent-pipeline/scripts/configure-data-model.mjs reviewed-data-model.json
node agent-pipeline/scripts/data-model-check.mjs
node agent-pipeline/scripts/render-data-model.mjs docs/data-model.contract.json data-model.html
```

Le guide contient aussi le prompt copiable pour mettre à jour un projet existant.

L’exécution reste indépendante du fournisseur dans le cœur. Un
[adaptateur d’exécution Codex](runtime-bundles/codex) borné et versionné est fourni
pour les versions de CLI déclarées dans son manifeste de compatibilité ; les autres
runtimes restent des adaptateurs du projet.

Le [contrat SvelteKit](profile-bundles/sveltekit) vérifie de manière exécutable une
plage bornée du scaffold officiel avant la calibration des contrôles propres au projet.

## Limites

La pipeline rend décisions, preuves, transitions et exceptions contrôlables. La clôture d’une issue protégée exige désormais une preuve durable de validation par l’opérateur ; la pipeline ne juge toutefois pas la qualité de cette revue. Elle ne choisit pas le produit ou l’architecture, ne transforme pas un prompt en permission et ne rend pas interactive une CLI qui ne l’est pas.

## Documentation

- [Installation d’un nouveau projet](docs/nouveau-profil.md)
- [Manuel opérateur](docs/operateur.md)
- [Machine d’état](docs/state-machine.md)
- [Handoffs et store](docs/handoff-store.md)
- [Gates de qualité](docs/quality-gates.md)
- [Sécurité dynamique, OWASP et charge](docs/security-testing.md)
- [Gouvernance des bases relationnelles](docs/database-governance.md)
- [Versions et mises à jour](docs/releases.md)

## Licence

[MIT](LICENSE)

[Isolation des exécutions, preuves conservées et réutilisation de la CI](docs/execution-maintenance.md).
