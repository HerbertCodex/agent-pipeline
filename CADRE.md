# Pipeline d'agents

Quatre rôles se passent le travail — **Product** découpe une demande en spec et en issues, **Implementer** épingle les critères en tests rouges, prouve le rouge, puis implémente, **QA** vérifie dans l'environnement réel, l'**Orchestrateur** valide, persiste et ordonnance. L'état durable vit dans un store sur disque, jamais dans la mémoire d'un agent : une coupure au milieu d'un cycle est indolore.

Ce répertoire est **autonome et agnostique**, entièrement : `scripts/`, `prompts/`, `docs/`, `templates/` et `skills/` ne connaissent ni langage, ni framework, ni gestionnaire de paquets. Aucun nom de stack n'y apparaît, pas même celui du profil actif — il est lu dans la configuration du projet hôte. Il se copie tel quel dans un dépôt Python, Go, Rust ou Svelte, sans rien en retirer.

## Si tu viens de copier ce répertoire dans un projet

**Il n'est pas encore configuré pour ce projet-là.** Tant qu'il ne l'est pas, il ne tourne pas : les commandes qu'il appelle sont celles de la stack précédente.

Donne ceci à ton agent, en remplaçant `<stack>` :

```text
Ce dépôt contient un pipeline d'agents dans agent-pipeline/, copié depuis un
autre projet. Il n'est pas encore configuré pour celui-ci, qui est en <stack>.

Lis agent-pipeline/docs/nouveau-profil.md et suis-le du début à la fin.

Le générateur de carte de projet est l'étape à ne pas survoler : le script
hérité est écrit pour la stack d'origine et ne marchera pas ici. Tu dois en
écrire un.

Ne me rends la main qu'après avoir répondu aux six questions du point de
contrôle final — chacune par une commande et sa sortie réelle, pas par une
appréciation.

Deux choses restent à moi : installer une dépendance, et éditer
pipeline.config.json une fois le pipeline en service. Demande-les moi.
```

Trois phrases y font le travail : le renvoi au guide, l'insistance sur le générateur de carte — dont l'omission est silencieuse, parce qu'une carte vide passe la porte au vert — et l'interdiction de conclure sans commandes à l'appui.

**Rien à remplacer ici** : ce répertoire ne contient aucun élément propre à une stack. Ce qui parle de la tienne — invariants et skills de stack — vit dans `<profiles_dir>/<profil>/`, à la racine du projet hôte.

## Par où entrer

| Tu es                                      | Lis                      |
| ------------------------------------------ | ------------------------ |
| L'humain qui installe et fait tourner      | `docs/operateur.md`      |
| L'agent qui configure le pipeline ici      | `docs/nouveau-profil.md` |
| Curieux de la mécanique avant de t'engager | `docs/state-machine.md`  |

`docs/operateur.md` est le seul document qui s'adresse à l'humain. Il donne les trois décisions qui ne partent jamais à un agent, et surtout ce qu'il faut configurer pour que les garanties écrites soient réelles — **les permissions de plateforme et les crochets git ne s'activent pas tout seuls**.

## Ce que porte ce répertoire

| Chemin       | Contenu                                                                                |
| ------------ | -------------------------------------------------------------------------------------- |
| `scripts/`   | Le core : ordonnancement, store, validation des handoffs, mesures. Tu n'y touches pas. |
| `prompts/`   | Les prompts des quatre rôles, sources de `AGENTS.md` et des briefs.                    |
| `docs/`      | Les règles détaillées, référencées par les prompts.                                    |
| `templates/` | `AGENTS.md`, `CLAUDE.md` et la CI, rendus par `apply-profile`.                         |
| `skills/`    | Les skills qui ne dépendent d'aucune stack, installés par `apply-profile`.             |
| `schemas/`   | La source de `rules_path`, copiée puis complétée par `apply-profile`.                  |

Ce qui parle de la stack vit **hors** d'ici, sans exception : `pipeline.config.json`, le répertoire `profiles_dir` qui porte invariants et skills de stack, `scripts/` à la racine du projet, `docs/stack/`, et le fichier `project_context` qui porte ce que `CLAUDE.md` dit du dépôt hôte. C'est la séparation qui rend la copie possible ; ne l'érode pas en introduisant une dépendance de stack dans `agent-pipeline/`.

Les résultats d'étalonnage ne voyagent pas non plus : `docs/etalonnage.md` porte le protocole, réutilisable tel quel, et les mesures restent dans le répertoire désigné par `benchmarks_dir` du projet hôte.

## Ce dont il a besoin

**Node et git suffisent au core.** Rien d'autre n'est installé par ce répertoire, et aucun paquet n'est requis pour l'exécuter.

Le projet hôte, lui, ajoute ses propres exigences par les portes qu'il déclare dans `pipeline.config.json` — un scanner de secrets, un client de forge, ses outils de test. Elles sont dans le `README` du dépôt hôte, pas ici.

Les scripts du core s'appellent partout par leur chemin :

```bash
node agent-pipeline/scripts/next-step.mjs      # le pas suivant du pipeline
node agent-pipeline/scripts/next-issues.mjs    # les issues dispatchables maintenant
node agent-pipeline/scripts/store-verify.mjs   # les invariants du store
node agent-pipeline/scripts/metrics.mjs        # débit et échappées
```

La plupart des projets les aliasent dans leur outil de tâches. Cette forme-là, elle, marche partout.

## La règle qui a coûté le plus cher

**Une consigne que rien ne fait mordre s'auto-annule.** Un prompt qui demande de lire un fichier « s'il existe », un mécanisme documenté qu'aucun script ne vérifie : personne n'échoue, personne ne signale, et la règle n'a jamais lieu.

Si une règle compte, elle a une porte ou un validateur derrière elle. C'est vrai du pipeline, et ce sera vrai de ce que tu lui ajouteras.
