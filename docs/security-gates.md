# Portes de sécurité

<!-- brief:orchestrator,product,implementer,qa -->
## Principes

Tout contrôle qu'un outil peut établir doit être exécuté ; une lecture humaine ou une réponse de modèle n'est pas une preuve déterministe. Aucun agent n'affirme de mémoire qu'un paquet ou un pattern est sûr : il exécute `audit`, consulte les advisories ou déclare l'incertitude. Toute décision d'autorisation est appliquée à la frontière de confiance, jamais seulement dans l'UI. En cas d'échec d'un contrôle : refuser (fail closed), jamais continuer avec un défaut permissif. Aucun secret dans le client, les logs, les fixtures ou le dépôt ; une clé détectée est rotée, sa suppression ultérieure ne l'efface pas de l'historique. Les messages d'erreur utilisateur ne divulguent ni requête, ni schéma, ni trace : le détail va dans le log serveur.
<!-- /brief -->

<!-- brief:qa,orchestrator -->
## Batterie QA et preuve CI

Un run CI vert sur le SHA exact vaut preuve pour les commandes qu'il a exécutées : QA le lit (`gh run list --commit <sha>`, `gh run view`), cite l'identifiant du run, et ne relance localement que ce que la CI ne couvre pas, ce qui a échoué, ou tout quand aucun run n'existe. Une divergence CI/local sur le même SHA est une anomalie d'infrastructure à remonter, jamais à trancher par relecture favorable. **La clôture d'une issue exige le run vert du SHA validé** : un run rouge ou absent interdit `closed`, même avec toutes les portes vertes en local ; la sortie est une faute d'infrastructure ou la faute de qui a cassé la commande, jamais une clôture sur preuve locale.

**Sans CI déclarée** (`ci.provider: "none"` dans la config), la preuve de clôture devient la batterie locale **complète** de QA : chaque commande de la config exécutée sur le SHA validé, code de sortie et sortie citées. Rien ne peut être sauté comme « couvert ailleurs », puisque rien ne l'est. Ce mode est un compromis assumé, à réserver aux projets qui ne peuvent pas avoir de CI : on perd l'environnement neutre reproductible et le rejeu indépendant du poste de l'agent ; la première action recommandée sur un tel projet reste d'en installer une, ce qui se fait en changeant une valeur de config et en relançant apply-profile. La batterie : `check`, `lint`, `build`, `test_unit`, `audit`, `secrets_scan`, `dead_code`, `sast`, `doc_lint`, `comment_policy`, plus le diff des fichiers de dépendances et de `.env*` contre `main`.
<!-- /brief -->

<!-- brief:qa,product -->
## Baseline de dépendances

La baseline volatile (findings acceptés, datés, motivés) vit dans `security-baseline.yml` à la racine. QA compare le résultat courant d'`audit` aux identifiants explicitement acceptés ; tout nouveau finding est escaladé à Product, même sur un paquet déjà en baseline. Même mécanisme pour le stock initial de `dead_code` et `sast` lors de l'adoption : l'état accepté est daté et committé, la porte ne bloque que le nouveau, le stock se résorbe par issues décidées par Product.
<!-- /brief -->

<!-- brief:product,implementer,qa -->
## Chaîne d'approvisionnement

Installation reproductible uniquement (la commande `install` du profil). Le lockfile est committé et fait foi. Toute nouvelle dépendance est une décision Product documentée : besoin exact, pourquoi l'existant ne couvre pas, signaux de maintenance, poids transitif, scripts d'installation, advisories datées, alternative rejetée. Un lockfile de code exécutable tiers est une dépendance : relecture humaine à chaque mise à jour.
<!-- /brief -->
