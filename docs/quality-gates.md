# Portes de qualité

Chaque exigence est soit une commande qui échoue, soit une preuve exigée dans un handoff, soit une revue outillée. Une exigence qui n'est aucune des trois n'existe pas.

<!-- brief:implementer,qa,orchestrator -->
## Code mort

La commande `dead_code` détecte exports jamais importés, fichiers orphelins et dépendances inutilisées ; elle tourne en CI et dans la batterie QA. Un symbole mort introduit par l'issue est retiré dans le même commit. Un symbole mort préexistant est signalé comme candidat dans le handoff, jamais retiré hors périmètre : Product décide. Un export « pour plus tard » est du code mort avec une excuse. Les faux positifs se déclarent dans la config de l'outil, committée et relue, jamais en désactivant la porte.

## Analyse statique de sécurité

La commande `sast` analyse le code du projet (`audit` ne couvre que les dépendances). Un finding est traité ou suppressé avec justification inline committée et relue ; une suppression sans raison est un rejet QA. La SAST complète les preuves d'intégration et la revue de frontières ; elle ne voit ni une policy manquante ni une décision prise du mauvais côté.
<!-- /brief -->

<!-- brief:implementer,qa,product -->
## Réutiliser avant d'écrire : la note de réutilisation

Le symptôme connu : un composant réécrit parce que personne n'a vérifié qu'il existait, puis deux copies qui divergent. **Tout handoff d'Implementer qui crée un composant, module, helper ou fonction partagée contient une note de réutilisation** dans son contexte : ce qui a été cherché, l'existant le plus proche avec son chemin, et en une phrase pourquoi il ne convient pas sans le déformer. QA rejette en faute `code` toute création sans note, et toute note dont l'existant aurait manifestement convenu. Product liste dans chaque issue les composants existants attendus en réutilisation ; un écart est une question, pas automatiquement une faute.

Ordre de préférence quand l'existant convient presque : l'utiliser tel quel ; l'étendre par un paramètre à défaut rétrocompatible ; en dernier recours créer une variante. Une variante créée pour éviter de toucher un composant partagé est le premier pas de la divergence : si l'extension casse un usage existant, c'est un conflit de périmètre à remonter, pas une raison de dupliquer.

## La carte du projet, contre laquelle la note est jugée

Exiger une note de réutilisation sans dire **où chercher** ne produit que des notes de complaisance : « j'ai cherché, je n'ai rien trouvé » est invérifiable. La carte rend cette phrase falsifiable.

`docs/project-map.md` est **généré depuis le code** et liste chaque export public avec sa nature et le rôle que sa documentation lui donne, harnais de test compris. Product la lit avant de spécifier, l'Implementer avant de créer, QA la confronte à toute création du diff.

Elle n'est jamais rédigée à la main. Une carte périmée est pire qu'une carte absente : elle affirme, donc plus personne ne vérifie, et le premier agent qui y lit une absence fera le doublon avec bonne conscience. La porte `project_map` rejoue la génération et échoue sur toute dérive — c'est ce qui autorise à lui faire confiance.

**Contrat de profil.** Le core ne sait pas lire votre langage : il exige seulement que la commande `project_map` du profil régénère la carte au chemin déclaré et supporte `--check`. `apply-profile` refuse une configuration qui ne la déclare pas. Un profil TypeScript peut passer par l'API du compilateur, un profil Dart par `analyzer`, un profil Swift par `sourcekitten` — les rôles ne voient qu'un chemin et une porte, jamais l'outil.
<!-- /brief -->

<!-- brief:implementer,qa -->
## Commentaires : le contrat survit, la narration périme

**Contrat exigé (`doc_lint`)** : toute fonction, classe, interface ou type **exporté** porte une documentation structurée du langage (JSDoc/TSDoc, docstring, JavaDoc) : description, paramètres, retour, erreurs. Un contrat documente ce qui reste vrai tant que la signature ne change pas ; c'est pourquoi il ne périme pas. Ne pas répéter les types déjà portés par le langage. La porte détecte la dérive : renommer un paramètre sans sa doc fait échouer la CI.

**Narration interdite (`comment_policy`)** : décrire ce que fait le code, bannières, code commenté, TODO sans issue : tout cela raconte l'implémentation d'aujourd'hui et ment demain. Le pourquoi va dans le message de commit ; un piège payé va dans le document de pièges du profil. Exceptions admises par le balayage, committées et relues : directives d'outils, annotations lues par une garde, marqueurs conventionnels du profil. Une fonction non exportée ne porte ni contrat ni narration : si son corps doit être raconté, c'est son nom ou son découpage qui est en cause.
<!-- /brief -->

<!-- brief:product,qa -->
## Ce qu'aucun outil ne prouve

Le découpage juste, le bon nom, l'abstraction au bon moment restent un jugement, outillé sans être automatisé : maquette validée avant le code pour les écrans à enjeu visuel, revue QA sur la cohésion (ce qui change ensemble vit ensemble) et le couplage, YAGNI avant SOLID (l'abstraction se paie quand le deuxième usage existe). Un rejet QA d'architecture cite la règle du profil violée et le coût concret observé, jamais un goût.
<!-- /brief -->
