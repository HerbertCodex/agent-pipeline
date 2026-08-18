# Skills

Un skill est un jeu d'instructions empaqueté, chargé à la demande dans l'agent qui en a besoin. Le pipeline en accorde l'outil aux quatre rôles depuis toujours ; ce document dit d'où ils viennent, qui les installe, et surtout **ce qu'ils ne remplacent pas**.

## Où ils vivent, et pourquoi à deux endroits

| Répertoire | Contenu | Voyage avec |
| --- | --- | --- |
| `agent-pipeline/skills/` | ce qui ne dépend d'aucune stack — conception, tests, refactoring, sécurité | le pipeline, dans tous les projets |
| `<profiles_dir>/<profil>/skills/` | ce qui parle d'une stack ou d'un domaine — interface web, mobile, données | le profil, et lui seul |

C'est la même coupure que pour `invariants.md` : le core ne sait pas dans quel langage il tourne, donc un skill qui parle de CSS ne peut pas y être. Un projet Go qui copie `agent-pipeline/` reçoit les cinq skills du core et aucun skill web — c'est exactement ce qu'on veut.

`apply-profile` les **installe** dans le répertoire `skills_dir` de la configuration. Ils y sont une cible générée au même titre que `AGENTS.md` : `apply-profile --check` échoue si l'installation dérive de sa source.

<!-- brief:implementer,qa,product,orchestrator -->

## Un skill est un conseil. Une porte est une contrainte.

**C'est la distinction à ne jamais perdre.** Un skill se déclenche parce qu'un agent a jugé qu'il correspondait à sa tâche. Rien ne l'y oblige, rien ne le vérifie, aucun handoff n'en porte la preuve. Un skill peut donc ne jamais être chargé sans que personne ne s'en aperçoive.

Il s'ensuit une règle ferme, et c'est celle qui a coûté le plus cher à ce pipeline sous d'autres formes : **si une règle d'un skill compte vraiment, le projet la transforme en commande de `commands`.** Tant qu'elle n'est qu'écrite dans un skill, elle s'auto-annule le jour où l'agent ne le charge pas.

Ce qui reste légitimement dans un skill : le jugement qu'aucune commande ne rend — le découpage juste, le bon nom, la hiérarchie visuelle, le choix d'un patron. Cela se relit en revue, cela ne se vérifie pas par un code de sortie.

## Charger celui que la tâche appelle, pas tous

Le routage — quel skill, à quel moment, pour quel rôle — vit dans les documents du projet, jamais ici : le core ne sait pas quels skills un profil embarque. Chercher dans son brief compilé la section qui l'indique.

Charger un skill nommé pour la tâche en cours. Les charger tous sature le contexte sans rien apprendre sur le travail à faire, et coûte à chaque tour.

Si l'invocation par nom échoue — un skill installé après le démarrage n'entre au registre qu'au redémarrage suivant — lire directement `<skills_dir>/<nom>/SKILL.md`. C'est le même contenu.

## Aucun agent ne modifie un skill

Un skill injecte des instructions dans un agent : c'est une surface de confiance, relue par un humain, jamais un espace de travail. Un besoin d'évolution se remonte à l'opérateur ; il ne s'écrit pas en cours de tâche. Un skill installé dans `skills_dir` est de surcroît une cible générée : l'y éditer serait écrasé au prochain rendu et signalé avant ça par `apply-profile --check`.
<!-- /brief -->
