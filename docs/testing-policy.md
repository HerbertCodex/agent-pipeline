# Politique de tests

Un test protège un comportement dont dépend un utilisateur ou un autre module. Rien d'autre. Une suite verte d'assertions de présentation est pire que pas de suite : fausse confiance, casse à chaque refactor inoffensif. Les obligations propres à la stack complètent ce socle dans les documents du profil.

<!-- brief:implementer,qa -->
## Ce qui n'est JAMAIS testé

Styles, classes, couleurs, layout ; markup statique (libellés, placeholders, conteneurs) ; comportement du framework ; bibliothèques tierces (on teste NOTRE usage) ; getters triviaux et ré-exports ; snapshots complets. La présentation, le responsive et l'accessibilité sont validés par QA dans l'application réelle selon le profil, jamais assertés en tests. L'Implementer reste responsable de les implémenter : « aucun test ne le couvre » n'est pas une défense.

## Mocks

Les mocks isolent NOTRE code. **Jamais asserter contre un mock ce que seul le système réel décide** : autorisations, contraintes, triggers, résolution de conflit de sync. Un tel test passe par construction. Ces preuves vont au niveau intégration, contre l'infrastructure réelle du profil. Avant de différer pour infrastructure manquante : inspecter les harnais existants, puis `blocked_infrastructure`, jamais un mock de remplacement.
<!-- /brief -->

<!-- brief:implementer,qa -->
## Sélection et budget

Un test par critère d'acceptation, plus les seuls cas limites qui corrompraient des données, perdraient le travail de l'utilisateur ou le bloqueraient. Par méthode : classes d'équivalence (un représentant par classe), valeurs limites (vide, zéro, un, max, max+1, null), chemins négatifs réellement gérés. Un test sans critère numéroté ni mode de défaillance nommé est supprimé.

Niveaux : **unitaire** par défaut ; **composant** uniquement si état, branchement sur props ou événements ; **intégration** pour ce que seul le système réel décide ; **E2E** 1 à 2 maximum, sur le parcours nommé de l'issue, par rôle et nom accessible, jamais par sélecteur de structure. Un test rouge doit échouer parce que le comportement manque, pas parce que le test est cassé ; tout test qui passe pour une mauvaise raison est supprimé ou réécrit.

## Fixtures

Du code committé : jamais de clé, token ou mot de passe réel, même expiré, même local. Valeurs manifestement fausses (`'test-anon-key'`) ou environnement local.
<!-- /brief -->

<!-- brief:qa,product,implementer -->
## Couverture : un signal, jamais une cible

La commande `coverage` du profil mesure la couverture et publie le rapport ; QA en cite le résumé dans chaque validation. Deux usages sont légitimes et deux seulement : la **couverture du diff** (les lignes introduites par l'issue sont exercées par la suite ; une branche neuve jamais exécutée est une question posée à l'Implementer), et le **cliquet** (le taux global ne descend pas sous la valeur committée dans la config de couverture ; il monte quand le travail le fait monter, jamais par des tests écrits pour lui).

Un seuil absolu comme objectif est interdit : il se satisfait de tests sans assertion et pousse à tester la présentation, exactement ce que cette politique interdit. La vraie porte de complétude reste la revue de critères : **un critère sans test qui le prouve est un rejet, à 100 % de couverture comme à 40 %.** Inversement, du code non couvert peut être légitime (branchement de plateforme, garde défensive documentée) : il se justifie dans le handoff, il ne se maquille pas.

<!-- /brief -->

<!-- brief:orchestrator -->
## Preuve de phase rouge

Au handoff `ready_for_qa`, l'orchestrateur rejoue `evidence.red_proof.cmd` contre le commit `test:` de l'issue et exige un code de sortie non nul avant de persister : un rouge qui rejoue vert est rejeté vers l'Implementer. C'est la preuve mécanique du TDD, et depuis que l'Implementer possède à la fois ses tests et son code, c'est **le** garde-fou qui a remplacé la frontière de rôles — aucune implémentation ne peut être validée sans échec constaté, pas seulement déclaré. `validate-handoff` refuse déjà un handoff sans `red_proof` ou dont l'`exit` vaut 0 ; le rejeu est ce qui distingue une preuve d'une affirmation.

Corollaire : les tests et l'implémentation vont dans **deux commits séparés**, `test:` puis `feat:`. Un commit unique rend la phase rouge inauditable et est rejeté. QA diffe ensuite les fichiers de test entre le commit de test et HEAD : tout assouplissement d'assertion non déclaré dans le handoff est une faute de code.
<!-- /brief -->

<!-- brief:implementer,qa -->
## Tests de sécurité

Tester la surface d'attaque que l'issue introduit réellement, nommée dans son champ « security surface ». Isolation inter-utilisateurs : en intégration, contre le système réel, obligatoire si l'issue touche une policy. Injection : uniquement là où une entrée atteint une requête brute, un filtre dynamique ou un rendu. Autorisation : tester le garde introduit, au niveau où la décision est prise. Sans surface : `// No security tests: <raison>` dans le fichier de test.
<!-- /brief -->
