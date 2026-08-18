# Workflow Git

Les commandes concrètes sont dans la table « Commandes du projet » du brief, alimentée par `pipeline.config.json`.

<!-- brief:product,orchestrator -->
## Branches

`main` est protégée : jamais de commit direct, merge via PR uniquement. **Une branche = une spec** (`feat/<nom>`, `fix/<nom>`, `hotfix/<nom>`) ; les issues d'une spec partagent sa branche. Une branche qui vit des semaines signale une spec à découper, pas une PR à multiplier. Toujours partir de `main` à jour, arbre propre (`git status --porcelain` vide).
<!-- /brief -->

<!-- brief:implementer,product -->
## Commits

Conventional Commits dans la langue `commit_language` du profil : `feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`, `security:`. Un commit = un changement logique, qui compile et passe `check` et `lint`. **Exception unique** : le commit `test:` de phase rouge compile mais ne passe pas ; aucun autre type n'en bénéficie et aucun autre rôle ne peut s'en réclamer. Jamais de `--no-verify`. Le pourquoi d'une décision non évidente va dans le message de commit, que `git blame` atteint depuis la ligne.
<!-- /brief -->

<!-- brief:implementer,orchestrator -->
## Branche partagée entre agents

Seul `git commit -m "..." -- <chemins-explicites>` est atomique : `git add` puis `commit` emporte ce qu'un autre agent a stagé entre les deux. La forme atomique isole le staging, pas les hooks : un hook qui balaie tout le dépôt peut échouer sur le fichier qu'un autre agent écrit ; c'est une sérialisation à assumer, jamais une raison de formater le fichier d'un autre ni d'utiliser `--no-verify`.

Si le changement **correct** casse un fichier hors périmètre : s'arrêter et remonter à l'orchestrateur (changement correct, fichier bloqué, erreur exacte). Rendre un champ optionnel ou élargir une signature « pour débloquer » est interdit : cette dette n'est plus reliée à sa cause par personne.
<!-- /brief -->

<!-- brief:implementer,product,qa -->
## Hooks et CI

`pre-commit` : format, `lint`, `secrets_scan` (la fuite ne doit pas entrer dans l'historique). `pre-push` : `check`, `lint`, `sync-briefs --check`, `apply-profile --check`. PAS `build` ni la suite complète ni `audit` : la CI générée les rejoue par SHA et fait foi. L'orchestrateur pousse la branche de spec après chaque persistance portant un commit ; pousser une branche de travail n'ouvre aucune PR.
<!-- /brief -->

<!-- brief:product -->
## Pull Requests

Une PR = une spec. Description : quoi, pourquoi, comment tester. Relire son propre diff. Squash merge recommandé. Relecture humaine obligatoire sur `human_review_paths` et les surfaces core.
<!-- /brief -->
