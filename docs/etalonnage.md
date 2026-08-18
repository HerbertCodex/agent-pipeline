# Étalonnage du pipeline

Une exigence **figée**, rejouée à froid à chaque fois que la configuration du pipeline change. Les mêmes mots, le même point de départ, les mêmes mesures — c'est le seul moyen de savoir si une modification du pipeline a amélioré ou dégradé quoi que ce soit.

Sans elle, un gain observé est inséparable de son facteur confondant le plus lourd : un opérateur qui découvre un dépôt et un opérateur qui le connaît ne produisent pas le même débit, et aucune métrique du store ne distingue les deux.

Ce document porte le **protocole**, qui vaut pour tout projet. L'exigence figée, elle, appartient au dépôt : elle vit dans `benchmarks_dir` avec les résultats, et n'a aucun sens ailleurs.

## Ce qui est figé, et ce qui ne l'est pas

**Figé** : le texte de l'exigence, mot pour mot. Le commit de départ, par son tag. Les commandes de mesure.

**Libre** : le découpage en issues, l'ordre, le nombre de cycles, l'implémentation. C'est exactement ce qu'on veut mesurer — Product décompose comme il le juge, et sa décomposition fait partie du résultat.

Ne jamais réécrire l'exigence pour « aider » un run. Une exigence retouchée invalide toutes les comparaisons antérieures, et la tentation viendra précisément le jour où un run se passe mal.

## Ce qu'une bonne exigence étalon exige

Elle doit **traverser toute la chaîne** du projet sans introduire de dépendance nouvelle — un blocage opérateur au milieu d'un run rend les durées incomparables.

Elle doit porter une **vraie décision de conception** plutôt qu'un enchaînement mécanique : un pipeline qui ne fait que suivre des ordres réussirait un CRUD trivial sans rien prouver.

Et elle doit être **réellement absente** du dépôt au tag de départ, vérifié plutôt que supposé. Une exigence déjà implémentée mesure la capacité à lire du code existant, pas à produire.

## Protocole

1. `git checkout -b bench/<date> <tag de depart>` — jamais depuis la branche par défaut, qui bouge.
2. `node agent-pipeline/scripts/benchmark.mjs --start` — enregistre l'instant, le tag, et l'empreinte de configuration.
3. Donner l'exigence, mot pour mot, et dérouler le pipeline normalement.
4. `node agent-pipeline/scripts/benchmark.mjs --finish` — mesure et ajoute une ligne à `runs.jsonl`.
5. **Récupérer la mesure et les découvertes sur la branche par défaut avant de jeter quoi que ce soit.** `runs.jsonl` est écrit sur la branche de run, donc supprimer celle-ci efface le résultat — le défaut a été trouvé au premier run d'un projet, où la mesure et dix-huit trouvailles allaient disparaître avec le code qu'elles décrivaient. Les découvertes valent souvent plus que la fonctionnalité produite : trois de ce run-là portaient sur des portes qui ne mesuraient pas ce qu'elles annonçaient.
6. Supprimer la branche. **Le résultat du run n'est pas du code à garder**, c'est une mesure — mais la mesure, elle, se garde.

## Lire les résultats sans se mentir

**Un run est un échantillon de un.** Deux exécutions de la même configuration donneront des chiffres différents — température du modèle, ordre des découvertes, aléas d'outillage. Au minimum deux runs par configuration avant de conclure quoi que ce soit.

**L'empreinte de configuration est ce qui rend la comparaison possible.** Elle hache les prompts, les documents, les règles et la config du profil. Deux runs d'empreintes différentes ne se comparent pas terme à terme : ils comparent deux pipelines.

**La durée est l'indicateur le plus bruyant et le plus séduisant.** Les indicateurs qui comptent sont les échappées, les cycles par issue, et les critères vérifiés au premier passage. Un run deux fois plus rapide qui laisse échapper un défaut est un run pire.

**Le facteur confondant que le protocole ne supprime pas** : le modèle sous-jacent change avec le temps. Un écart entre deux runs séparés de plusieurs mois mélange l'effet de ta configuration et celui du modèle. Noter la date et le modèle dans chaque run est le minimum ; ne pas conclure sur des runs trop éloignés est la vraie discipline.

## Au portage

`benchmarks_dir` de la configuration désigne le répertoire des résultats — par défaut `docs/benchmarks`. **Son contenu appartient au projet d'origine** : en installant le pipeline ailleurs, vide-le. Un nouveau dépôt qui démarre avec les `runs.jsonl` d'un autre compare deux projets sans le savoir, et hérite d'une exigence figée qui décrit une application qu'il n'a pas.
