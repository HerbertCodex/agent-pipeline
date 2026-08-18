# Point d'entrée

{{project_summary}} Ce fichier est chargé à chaque session : il dit où regarder, pas ce que contiennent les autres documents.

## À lire avant d'agir

| Quand                                  | Quoi                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| Toujours, en premier                   | `AGENTS.md` — rôles, sources de vérité, interdits                              |
| Avant de créer quoi que ce soit        | `docs/project-map.md` — **généré**, liste chaque export existant avec son rôle |
| Avant de toucher à une décision passée | `docs/decisions/` — dépendances, arbitrages, risques acceptés                  |
| Pour le détail d'une règle             | `agent-pipeline/docs/`                                                         |

`docs/project-map.md` est la réponse à « est-ce que ça existe déjà ? ». Le lire avant de créer un module, un service, un helper ou un harnais de test n'est pas optionnel : la note de réutilisation exigée de tout ajout est jugée contre lui.

## Comment le travail se fait

L'utilisateur exprime un besoin en langage naturel. Le pipeline s'en charge :

**Product** rédige la spec et la découpe en issues → **Implementer** épingle les critères en tests rouges, prouve le rouge, puis implémente → **QA** vérifie dans l'environnement et écrit le registre → **Orchestrateur** valide, persiste, ordonnance.

L'opérateur humain garde trois choses pour lui : installer une dépendance, éditer `pipeline.config.json`, et merger.

## Avant toute demande de fonctionnalité : demander

**Une session ne lance pas de sous-agents sans demande explicite.** C'est une règle plateforme, au-dessus de ce fichier : le pipeline ne partira donc jamais tout seul. Conséquence directe et déjà constatée — une session neuve enchaîne en direct, fait du bon travail, et rien n'en arrive au pipeline.

Alors **demander, avant de commencer** : pipeline ou direct ? Et nommer ce que le direct perd, sans l'atténuer :

- **aucune trace dans le store** — `pipeline:next`, `pipeline:metrics` et `status.html` ignorent que le travail existe ; il vit dans git, pas dans le pipeline ;
- **pas de découpage Product** — la session décide seule du contrat puis écrit les tests qui le valident, donc son implémentation est jugée contre elle-même ;
- **pas de QA indépendante** — les portes automatiques restent vertes, mais la revue conditionnelle de `docs/stack/` (entrées hostiles, en-têtes comparés et pas seulement les corps, idempotence rejouée contre l'application réelle) n'a lieu pour personne ;
- **pas de `verify-scope`, pas de verrou optimiste, pas de registre de vérification.**

Travailler en direct est légitime — pour un correctif d'outillage, une question, une exploration. Ce qui ne l'est pas, c'est d'y aller **sans que l'opérateur l'ait su**.

## Commandes

```
{{project_commands}}
```

Les portes de qualité sont dans `pipeline.config.json` sous `commands`. Toute règle qui nomme une commande par sa clé — `check`, `lint`, `test_unit` — désigne celle-là.

## Ce qui est vrai de ce dépôt et qu'on oublie

{{project_context}}

## La règle qui a coûté le plus cher à réapprendre

**Une consigne que rien ne fait mordre s'auto-annule.** Un prompt qui demande de lire un fichier « s'il existe », un mécanisme documenté qu'aucun script ne vérifie : personne n'échoue, personne ne signale, et la règle n'a jamais lieu. Si une règle compte, elle a une porte ou un validateur derrière elle.
