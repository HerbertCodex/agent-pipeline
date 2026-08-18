# Machine à états

La source machine est le fichier `rules_path` : phases et propriétaires, transitions, routage des fautes, phases tenant réservation. Ce document l'explique ; en cas d'écart, le fichier fait foi et le document est le défaut à corriger.

<!-- brief:orchestrator,product,implementer,qa -->

## Flux et propriété

Flux nominal d'une issue :

`planned -> in_progress -> ready_for_qa -> qa_in_progress -> closed`

| Phase          | Propriétaire | Précondition de sortie                        |
| -------------- | ------------ | --------------------------------------------- |
| planned        | orchestrator | issue créée, branche prête, réservation posée  |
| in_progress    | implementer  | tests rouges prouvés puis verts, critères couverts, deux commits |
| ready_for_qa   | orchestrator | handoff validé, rouge rejoué, scope vérifié    |
| qa_in_progress | qa           | batterie + revue qualitative                   |
| closed         | none         | aucune                                         |

Blocages : `blocked_product` (critères absents/ambigus), `blocked_dependency` (décision de paquet), `blocked_infrastructure` (stack indisponible), `operator_escalation`. Toute transition hors de la liste de `rules.json` est refusée par `store-update` — le script confronte le couple `(phase quittée, phase visée)` à `transitions` et échoue sans rien écrire. Cette phrase a été fausse jusqu'au 2026-08-17 : elle décrivait un contrôle qui n'existait pas, et seule la discipline des rôles la rendait vraie.

Écrire un `pipeline_state` dont la phase est **inchangée** est un *amendement*, pas une transition : la version avance d'un, le journal `transitions` n'enregistre rien. C'est le chemin pour corriger des réservations ou un champ d'état sans fabriquer un mouvement que `metrics` compterait.

## Un seul rôle écrit les tests et le code

L'Implementer possède les deux. C'est délibéré : la frontière Test Writer / Coder coûtait un handoff complet, un démarrage à froid et deux transitions persistées par issue, pour un bénéfice qui n'est apparu qu'une fois sur six issues mesurées.

Ce que cette frontière garantissait structurellement — **personne ne peut écrire le test après le code** — n'est plus garanti par l'organisation. Trois mécanismes le remplacent, et ils ne sont pas décoratifs :

1. **`evidence.red_proof`**, la commande exacte et son code de sortie non nul, observés avant toute implémentation. `validate-handoff` refuse un handoff sans elle, et refuse un `exit` à 0.
2. **Le rejeu par l'orchestrateur.** Il relance la commande de rouge contre le commit `test:` et exige un code non nul. Une preuve déclarée n'est pas une preuve.
3. **Deux commits séparés**, `test:` puis `feat:`. C'est ce qui rend la phase rouge auditable après coup : QA diffe les fichiers de test entre le commit de test et HEAD, et tout assouplissement d'assertion non déclaré est une faute de code.

Un commit unique mélangeant tests et implémentation est un rejet : il rend ces trois vérifications impossibles.

## Le registre : ce qui est connu vrai, pas ce qui a été déclaré

Les phases décrivent **où en est le travail**, jamais **ce qui est établi**. Une issue est `closed` ou elle ne l'est pas ; sans autre mécanisme, le store enregistre donc ce que les agents ont *dit* avoir fait.

`criteria_ledger` corrige ça : une entrée par critère d'acceptation, dans l'ordre, portant un statut et la preuve **observée dans l'environnement**.

`unverified` (rien ne l'a établi) · `pending` (montré en partie, non concluant) · `blocked` (un obstacle empêche la vérification, ou le critère est contredit) · `verified` (constaté satisfait).

**QA en est le seul auteur.** Une déclaration d'Implementer ne devient jamais une entrée de registre — c'est précisément la confusion que le registre existe pour empêcher. `verified` et `blocked` exigent une preuve : une commande et son code de sortie, un corps de réponse, une valeur mesurée. « L'Implementer l'affirme » n'est pas une preuve.

Deux gardes, aux deux bouts. `validate-handoff` refuse une clôture dont le registre est incomplet, porte une entrée non `verified`, ou annonce `verified` sans preuve. `store-verify` refuse une issue fermée dont le registre est en désaccord. Une clôture persistée est donc une clôture que quelqu'un a mesurée.

Écrire `unverified` sans honte quand rien n'a été établi : un registre qui promeut discrètement un critère non prouvé est pire qu'un rejet, parce que tout ce qui est en aval fait confiance au store.

## Les découvertes deviennent des issues

Une trouvaille faite en route — un doublon à mutualiser, un écart entre le contrat documenté et le comportement réel, une dette aperçue — meurt dans la prose de la PR qui la portait si rien ne l'attache.

Tout handoff peut porter des `discoveries`. L'orchestrateur en fait des issues créées avec `discovered_from`, ce qui pose une relation `discovered-from` vers celle qui les a fait apparaître. Elles naissent `planned`, avec leurs propres réservations, et l'ordonnanceur les place comme les autres. L'agent qui trouve ne s'élargit pas le périmètre : il nomme.

**Une découverte accompagne une validation, elle ne s'y oppose pas.** Une issue peut satisfaire tous ses critères et avoir néanmoins fait apparaître un défaut qui n'appartient à personne dans le cycle : une dette préexistante, un critère qui nommait la mauvaise réponse, un écart entre le contrat documenté et le comportement réel. Sans cette case, QA n'a que deux issues — valider et perdre la trouvaille, ou rejeter une implémentation correcte pour une faute qu'elle n'a pas commise. Sur les neuf premières issues de ce dépôt, elle a choisi la première neuf fois, et toutes les trouvailles sont mortes en prose de PR.

Le mécanisme est opposable, pas indicatif : `validate-handoff` refuse une découverte sans motif, et `store-verify` refuse de fermer une issue dont les découvertes déclarées n'ont pas donné d'issue reliée. Une consigne que rien ne fait mordre s'auto-annule.

## Une faute de code repasse par un test

Quand QA trouve une faute de **code**, elle a par définition trouvé un défaut qu'aucun test n'attrapait. La faute revient à l'Implementer en `in_progress`, et `regression.required: true` — le défaut — l'oblige à épingler le comportement nommé dans `regression.criterion` par un test rouge, avec une preuve de rouge fraîche, avant de corriger. L'exception `regression.required: false` est réservée à ce que la politique de tests interdit d'asserter et exige une `reason` écrite. Le compteur `qa_code_rejections` s'incrémente dans les deux cas ; à 3, `operator_escalation` obligatoire.

<!-- /brief -->

<!-- brief:orchestrator -->

## Réservations et parallélisme

Le bloc `pipeline_state` porte `file_reservations` : les motifs de chemins que l'issue va modifier. Deux issues dont les motifs se croisent s'écrasent silencieusement : l'arbre compile et l'un des deux changements a disparu. `check-reservations` calcule le chevauchement (règle conservatrice par préfixes littéraux : elle peut sur-bloquer, jamais sous-bloquer) et refuse le dispatch. Une issue tient ses chemins de sa sortie de `planned` jusqu'à `closed`, phases bloquées comprises. Une issue sans réservation est **non gardée**, jamais sûre. Une dépendance d'issue non fermée bloque le dispatch, indépendamment des réservations.

Le parallélisme est la seule chose que ce pipeline fait mieux qu'un humain seul, et il se décide en amont : c'est une propriété du découpage produit, pas du runtime. Une chaîne strictement séquentielle paie tous les handoffs sans jamais recouvrir un temps d'attente.

## Ce qui se mesure, et ce qui ne se mesure pas

`store-update` inscrit chaque transition dans `transitions` — `{from, to, at, version}` — et renseigne `closed_at` à la fermeture. Auparavant seul le dernier horodatage survivait : ni durée par phase, ni compte de cycles.

`metrics.mjs` en dérive le débit par spec, et surtout **l'échappée** : un défaut passé par QA et découvert plus tard, lisible dans les relations `discovered-from` pointant vers une issue déjà fermée. C'est le seul indicateur de qualité qui vaille — il mesure si le filtre filtre.

Trois pièges que l'outil nomme lui-même plutôt que de les laisser tendre :

**Un compteur de rejets à zéro ne prouve rien.** Il dit que QA n'a pas eu de motif de rejet dans le périmètre, pas que rien n'a échappé. Sur les neuf premières issues de ce dépôt il valait zéro pendant que QA trouvait de vrais défauts qu'aucune case n'accueillait.

**Zéro échappée sans aucune découverte enregistrée ne mesure rien non plus** — c'est l'absence d'usage du mécanisme, pas l'absence de défaut. `metrics.mjs` refuse de laisser lire ce zéro comme un signal.

**Rien de tout ceci n'est une statistique.** Un projet, quelques dizaines d'issues, un seul opérateur : ce sont des indications. Le risque principal est de lire un effet dans du bruit — et le facteur confondant le plus lourd n'apparaît dans aucun chiffre, c'est qu'un opérateur qui découvre un dépôt et un opérateur qui le connaît ne produisent pas le même débit. Seule une spec étalon rejouée à froid sépare les deux.

## L'ordre de travail se calcule

`next-issues.mjs` rend la vague dispatchable : les issues `planned` dont toutes les dépendances sont `closed`, dont les réservations ne croisent ni celles d'une issue en cours ni celles d'une autre issue de la même vague. La vague est **deux à deux disjointe par construction** — tout ce qu'elle contient part en parallèle sans qu'une écriture en écrase une autre.

Le tri est topologique par construction (une dépendance non fermée exclut), puis par priorité, puis par identifiant, pour que deux exécutions rendent la même vague. Une issue sans réservation est écartée comme non gardée, jamais supposée sûre.

L'orchestrateur suit cette sortie au lieu de reconstruire l'ordre par lecture. Un ordonnancement sous contraintes est un travail d'algorithme : le confier au jugement d'un modèle, c'est payer cher une réponse moins fiable.

## Un commit de store par issue

L'état est persisté à chaque transition — le record doit toujours refléter la réalité — mais les écritures ne sont **pas** committées une par une. Elles restent indexées et partent en un seul commit à la clôture de l'issue. Sur la dernière spec mesurée, 40 des 55 commits étaient des transitions d'état pour 338 lignes de code livrées.

Deux exceptions committées immédiatement : `operator_escalation`, et tout état sur lequel un humain doit agir.

## États de spec

`draft -> active -> ready_for_pr -> pr_open -> merged`. Une spec passe à `ready_for_pr` quand toutes ses issues sont `closed` et que QA a rejoué la batterie complète sur le SHA final. Product prépare la PR, l'orchestrateur persiste le résultat via une requête `spec_state`, l'opérateur relit et merge.

Un handoff de spec porte `mode: "spec_handoff"` et **pas** de `basis.pipeline_version` : un record de spec n'a pas de `pipeline_state.version`. Inventer une valeur pour satisfaire un validateur est interdit ; si un champ obligatoire n'a pas de valeur vraie, le schéma est en tort et le cas remonte à l'opérateur.

<!-- /brief -->
