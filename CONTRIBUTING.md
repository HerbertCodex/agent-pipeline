# Contribuer

Ce dépôt applique à lui-même la règle qu'il impose aux projets qui l'utilisent. Le lire avant d'ouvrir une PR fait gagner un aller-retour.

---

## ⚖️ La règle qui gouverne tout

> **Si aucune commande ne peut la refuser, une règle ne s'applique jamais.**

Une consigne dans un prompt, un mécanisme documenté qu'aucun script ne vérifie : personne n'échoue, personne ne signale, et la règle n'a jamais lieu.

Concrètement, pour une PR ici : **si votre changement introduit une règle, montrez la commande qui la fait échouer.** Sinon la PR ajoute du texte, pas du comportement.

Ce dépôt a violé cette règle une douzaine de fois sur lui-même. Chaque fois, le défaut a été trouvé en allant vérifier une phrase qui semblait vraie.

---

## 🔴 L'ordre de travail

**Le test d'abord, et il doit être rouge.**

```console
$ node --test test/ma-nouvelle-porte.test.mjs
pass 2   fail 7      ← la preuve que le test mesure quelque chose
```

Puis le code, puis vert. Une PR qui arrive avec code et tests écrits ensemble ne prouve pas que les tests mordraient si le code changeait.

### Et vérifiez que votre casse casse vraiment

Avant de dire qu'une porte fonctionne, **retirez-la et regardez tomber ses tests** :

```console
$ # appel au contrôle retiré
$ node --test test/ma-porte.test.mjs
pass 4   fail 5      ← exactement les tests de refus, et eux seuls
```

Un motif de remplacement qui ne trouve rien laisse la porte verte et ne prouve rien. **C'est arrivé trois fois sur ce dépôt en une seule journée**, chaque fois en produisant un vert rassurant.

---

## 🧪 Lancer la suite

```bash
node --test "test/**/*.test.mjs"
```

Aucune dépendance à installer. Node seul.

Les tests s'exécutent dans un bac à sable jetable (`test/harness.mjs`) : chacun a son propre dépôt temporaire, sa propre configuration, son propre store. Aucun test ne peut écrire dans autre chose que le sien.

---

## 🚫 Ce qui fera refuser votre PR

| Contrôle | Ce qu'il refuse |
| :-- | :-- |
| `test/agnosticite.test.mjs` | un script du core qui appelle `npm`, importe un paquet, ou écrit en dur un chemin que la configuration possède |
| `test/langue.test.mjs` | un message, un intitulé de test ou un commentaire en français |
| `test/duplication` côté projet | un bloc répété ailleurs dans le dépôt |

Ces trois-là attrapent la grande majorité des PR refusées, et les trois ont déjà attrapé l'auteur du dépôt.

---

## 📂 Où va quoi

**`scripts/` ne connaît aucun langage.** Pas de `npm`, pas de paquet importé, pas de chemin supposé. Ces scripts doivent tourner tels quels dans un projet Python, Go ou Rust. Un test le vérifie.

**`skills/` porte ce qui ne dépend d'aucune stack.** Ce qui dépend d'une stack appartient au profil du projet hôte, pas ici.

**Un skill peut déclarer `applies_to`** dans son en-tête :

```yaml
applies_to: frontend, mobile, fullstack
```

Il n'est alors pas installé là où le type de projet ne correspond pas. Un conseil sur les écrans, posé dans un service qui n'en a pas, n'est pas inerte — un agent le lit et essaie de le suivre.

---

## 🇬🇧 La langue

**Tout est en anglais** : documents, prompts, messages d'erreur, intitulés de tests, commentaires du code. Une porte le vérifie.

**Ce fichier et le README sont l'exception**, en français : ils s'adressent à des humains, le reste est lu par des modèles.

Le détecteur travaille sur une liste de mots, et il l'avoue dans son propre commentaire : la liste a une traîne longue. Les terminaisons ont été essayées puis retirées — `guarantee` et `questionnaire` sont anglais, et **une porte qui refuse de l'anglais est désactivée le lendemain**. Si un mot français passe, ajoutez-le à la liste dans la même PR.

---

## ✍️ Ce qu'un bon message de commit dit ici

Le **pourquoi**, pas le quoi. Le diff dit déjà le quoi.

Ce qui a le plus de valeur, dans l'ordre :

1. **le défaut réel que ça ferme**, avec sa date si vous l'avez vécu ;
2. **ce que le mécanisme ne fait pas** — une limite écrite vaut mieux qu'une limite découverte ;
3. ce que vous avez cassé exprès pour vérifier.

Un exemple qui existe dans l'historique :

> *Une escalade de QA était impossible à exprimer. `rules.json` déclarait la transition, le prompt de QA la prescrivait, et `validate-handoff` exigeait une faute routée vers autre chose. Toute escalade soumise était refusée, quel que soit son contenu.*

---

## 🙅 Ce qui ne sera pas mergé

- **Un seuil desserré pour faire passer une porte.** Un seuil desserré une fois se desserre encore. Lisez ce que la porte a trouvé avant d'y toucher.
- **Une porte sans sortie satisfaisable.** Une règle impossible à respecter est supprimée le lendemain par quelqu'un qui a du travail à finir.
- **Un `--no-verify`.** Jamais.
- **Une dépendance ajoutée au core.** Il n'en a aucune, et c'est ce qui lui permet d'être copié tel quel dans n'importe quel projet.

---

## 🐛 Signaler un défaut

Ce qui aide vraiment : **la commande, sa sortie réelle, et ce que vous attendiez.**

Ce qui n'aide pas : « ça ne marche pas ». Le cadre entier existe pour remplacer les impressions par des mesures ; un rapport de bug est le premier endroit où l'appliquer.

Si le défaut est qu'une porte **n'a rien refusé alors qu'elle aurait dû**, c'est le plus précieux des rapports. Un vert qui ne mesure rien est pire qu'un rouge.
