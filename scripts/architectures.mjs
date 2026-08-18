/**
 * Types de projet reconnus a la configuration.
 *
 * Le type change la reponse, pas seulement le vocabulaire : parler de ports
 * et d'adaptateurs a une interface web n'a pas le meme sens qu'a un service
 * qui parle a trois bases. Un choix presente hors du type de projet est un
 * catalogue, pas une aide a la decision.
 */
export const PROJECT_TYPES = {
  backend: {
    label: "Service back-end",
    blurb: "Une API sans interface. Ce qui bougera : les sources de données, les intégrations. Rarement les écrans, il n'y en a pas.",
    example: "ajouter une route qui lit un livre",
  },
  frontend: {
    label: "Interface web",
    blurb: "Une application dans un navigateur. Ce qui bougera : les écrans et les parcours. Presque jamais la source des données.",
    example: "ajouter un écran qui affiche un livre",
  },
  mobile: {
    label: "Application mobile",
    blurb: "Une application native. Ce qui bougera : les écrans et l'état local, sous contrainte de connexion intermittente.",
    example: "ajouter un écran qui affiche un livre",
  },
  fullstack: {
    label: "Front et back dans le même dépôt",
    blurb: "Deux produits, un dépôt. La vraie question n'est pas leur structure interne mais ce qui passe entre les deux.",
    example: "afficher un livre, de la base à l'écran",
  },
};

/**
 * Les questions qui decident, avant tout nom d'architecture.
 *
 * Un operateur qui choisit par le nom choisit par la mode. Ces questions se
 * repondent sans connaitre aucune architecture, et leurs reponses eliminent
 * la plupart des options avant qu'on les nomme.
 */
export const DECISION_AXIS = [
  {
    question: "Allez-vous vraiment remplacer votre base de données ?",
    short: "Presque toujours : non.",
    why: "C'est la question qui élimine le plus d'options. Certaines architectures existent pour qu'on puisse changer de base sans toucher au reste. Ça se paie à chaque route écrite. Si vous ne changerez jamais, vous payez une assurance que vous n'utiliserez pas.",
    answers: [
      ["Non, jamais", "Écartez l'hexagonale et Clean. Vous n'avez pas le problème qu'elles résolvent."],
      ["Peut-être un service tiers", "Isolez ce service-là uniquement. Pas le reste."],
      ["Oui, c'est le métier", "L'hexagonale se justifie vraiment. C'est rare."],
    ],
  },
  {
    question: "Vos règles métier survivraient-elles à un changement complet de technologie ?",
    short: "Y a-t-il un métier, ou juste des données ?",
    why: "Certaines architectures isolent les règles métier du reste. Encore faut-il qu'il y ait des règles. Un service qui lit une table et la renvoie en JSON n'a pas de métier : il a un schéma. Lui ajouter une couche métier crée des fichiers qui recopient des lignes.",
    answers: [
      ["On transporte et on valide", "Le découpage par fonctionnalité suffit largement."],
      ["Quelques règles qui comptent", "Isolez ces règles-là. Pas tout le modèle."],
      ["Des règles denses, discutées avec le métier", "Clean ou Onion prennent leur sens."],
    ],
  },
  {
    question: "Combien de personnes ou d'agents travaillent en même temps ?",
    short: "Seul, on optimise la cohérence. À plusieurs, le parallélisme.",
    why: "Ranger par couche technique met tout le monde dans les mêmes dossiers : chaque fonctionnalité traverse toutes les couches. Ranger par fonctionnalité donne à chacun son dossier. C'est le critère le plus concret des quatre.",
    answers: [
      ["Une personne à la fois", "Le rangement par couche reste lisible."],
      ["Deux à cinq", "Rangez par fonctionnalité. Chacun son dossier."],
      ["Plusieurs équipes", "Modules autonomes avec des contrats entre eux."],
    ],
  },
  {
    question: "Dans vos projets précédents, qu'est-ce qui changeait le plus souvent ?",
    short: "Mettez au centre ce qui bouge le moins.",
    why: "Une architecture protège ce qu'elle place au centre. L'erreur classique est de protéger ce qui ne bouge jamais et de laisser en périphérie ce qui change chaque semaine. On ne s'en aperçoit qu'après deux ans.",
    answers: [
      ["Les écrans, les parcours", "Rangez par fonctionnalité, pas par couche."],
      ["Les règles métier", "Isolez-les, avec des tests qui ne connaissent aucune technologie."],
      ["Les intégrations externes", "C'est là, et seulement là, que les ports se justifient."],
    ],
  },
];

/**
 * Catalogue des architectures.
 *
 * `layers` et `allowed` ne sont pas decoratifs : ce sont exactement les
 * champs que la declaration portera dans la configuration. L'operateur lit
 * donc ce que la porte appliquera.
 */
export const ARCHITECTURES = [
  {
    id: "feature-modules",
    grows_into: "Un module dont les règles deviennent denses se durcit tout seul, sans toucher aux autres.",
    migration_triggers: ["La même règle métier apparaît dans deux modules → sortez-la dans un module partagé, une seule fois.","Vous devez vraiment remplacer une intégration → mettez un port sur celle-là, pas sur le reste.","Un module dépasse une dizaine de règles discutées avec le métier → isolez SON domaine, lui seul."],
    migration_cost: "Faible et local. On durcit un dossier à la fois, les autres ne bougent pas. C'est la seule option qui se laisse quitter par morceaux.",
    layers: { partage: ["src/shared/**", "src/partage/**"], fonctionnalites: ["src/*/**"] },
    allowed: { fonctionnalites: ["partage"], partage: [] },
    name: "Un dossier par fonctionnalité",
    applies: ["backend", "frontend", "mobile", "fullstack"],
    plain: "Tout ce qui concerne les livres est dans le dossier « livres ». Tout ce qui concerne les emprunts est dans « emprunts ». On ne range pas par nature technique.",
    tree: ["src/", "├── catalogue/      tout sur les livres", "├── emprunts/       tout sur les prêts", "└── partagé/        ce que les deux utilisent"],
    chain: ["catalogue", "partagé"],
    files_for_example: ["catalogue/service", "catalogue/controleur", "catalogue/tests"],
    cost: "Presque rien. Une seule règle : un dossier ne fouille pas dans un autre, il passe par ce que l'autre publie.",
    buys: "Deux personnes travaillent sans se croiser. Supprimer une fonctionnalité, c'est supprimer un dossier.",
    wrong_when: "Quand deux fonctionnalités partagent beaucoup de règles : elles finissent copiées, ou le dossier « partagé » devient un fourre-tout.",
    verdict: "Le choix par défaut raisonnable. Commencez là. On monte en abstraction quand une douleur précise l'exige, pas avant.",
  },
  {
    id: "layered",
    grows_into: "Passer au découpage par fonctionnalité veut dire déplacer presque tous les fichiers.",
    migration_triggers: ["Deux personnes se gênent régulièrement dans les mêmes dossiers → le découpage est déjà faux.","Vous cherchez longtemps où poser une nouvelle règle → la couche ne dit rien du sujet."],
    migration_cost: "Élevé et global. Chaque fonctionnalité est éparpillée dans trois dossiers : on ne migre pas par morceaux.",
    layers: { controleurs: ["src/**/*.controller.*"], services: ["src/**/*.service.*"], donnees: ["src/persistence/**", "src/**/*.repository.*"] },
    allowed: { controleurs: ["services"], services: ["donnees"], donnees: [] },
    name: "Rangé par couche technique",
    applies: ["backend", "fullstack"],
    plain: "Tous les contrôleurs ensemble, tous les services ensemble, tout l'accès aux données ensemble. On range par nature, pas par sujet.",
    tree: ["src/", "├── controleurs/    reçoivent les requêtes", "├── services/       la logique", "└── donnees/        parlent à la base"],
    chain: ["controleurs", "services", "donnees"],
    files_for_example: ["controleurs/livres", "services/livres", "donnees/livres"],
    cost: "Faible, et familier. Trois dossiers, une règle de sens.",
    buys: "Chaque chose a une place évidente. Quelqu'un qui arrive sait où chercher.",
    wrong_when: "Dès qu'on travaille à plusieurs. Une seule fonctionnalité touche les trois dossiers, donc tout le monde édite les mêmes endroits.",
    verdict: "Honnête pour un projet à une personne. C'est le rangement qui se parallélise le plus mal.",
  },
  {
    id: "hexagonal",
    grows_into: "Rien ne pousse à en sortir : on garde la cérémonie, même quand elle ne sert plus.",
    migration_triggers: ["Vous n'avez jamais remplacé un seul adaptateur en deux ans → le coût a été payé pour rien, mais personne ne retire des ports."],
    migration_cost: "Le retour en arrière ne se fait pas. On vit avec. C'est pourquoi ce choix se prend tard, pas tôt.",
    layers: { domaine: ["src/domain/**"], application: ["src/application/**"], adaptateurs: ["src/adapters/**", "src/infrastructure/**"] },
    allowed: { adaptateurs: ["application", "domaine"], application: ["domaine"], domaine: [] },
    name: "Hexagonale (ports et adaptateurs)",
    applies: ["backend", "fullstack"],
    plain: "Le cœur du logiciel dit « j'ai besoin de quelqu'un qui sait enregistrer un livre » sans savoir si c'est une base, un fichier ou un service distant. On branche l'un ou l'autre derrière.",
    tree: [
      "src/",
      "├── domaine/        les règles, aucune technologie",
      "│   └── ports/      « j'ai besoin de… »",
      "├── application/    orchestre les règles",
      "└── adaptateurs/    la vraie base, le vrai HTTP",
    ],
    chain: ["adaptateurs", "application", "domaine"],
    files_for_example: [
      "domaine/livre (l'objet)",
      "domaine/ports/depot-livres (l'interface)",
      "application/lire-livre (le cas d'usage)",
      "adaptateurs/sqlite/depot-livres (l'implémentation)",
      "adaptateurs/http/controleur-livres",
      "+ un faux dépôt pour les tests",
    ],
    cost: "Élevé, et à chaque fois. Six fichiers là où il en fallait trois. La moitié ne fait que passer l'information d'un étage à l'autre.",
    buys: "Changer de base sans toucher aux règles. Tester les règles sans base du tout. Réel — mais seulement le jour où on change vraiment.",
    wrong_when: "Quand on ne changera rien. Une base choisie une fois n'est pas un branchement, c'est une décision. L'interface qui l'entoure ne sert alors à personne.",
    verdict: "Justifiée quand brancher des systèmes différents EST le métier. Sur-ingénierie partout ailleurs — et c'est le cas le plus fréquent.",
  },
  {
    id: "clean",
    grows_into: "Comme l'hexagonale : on n'enlève pas des couches, on les subit.",
    migration_triggers: ["Vos cas d'usage ne font qu'appeler une méthode → la couche ne porte rien, mais la retirer touche tout."],
    migration_cost: "Le plus difficile à quitter du catalogue. À réserver aux domaines qu'on sait denses AVANT de commencer.",
    layers: { entites: ["src/entities/**", "src/domain/**"], "cas-usage": ["src/usecases/**"], adaptateurs: ["src/adapters/**"], infrastructure: ["src/infrastructure/**"] },
    allowed: { infrastructure: ["adaptateurs", "cas-usage", "entites"], adaptateurs: ["cas-usage", "entites"], "cas-usage": ["entites"], entites: [] },
    name: "Clean Architecture",
    applies: ["backend", "mobile", "fullstack"],
    plain: "Des cercles emboîtés. Au centre les objets métier, autour les cas d'usage, puis les branchements, puis le framework. Tout pointe vers le centre, jamais l'inverse.",
    tree: [
      "src/",
      "├── entites/        objets métier purs",
      "├── cas-usage/      un fichier par action",
      "├── adaptateurs/    traduisent vers l'extérieur",
      "└── infrastructure/ base, framework, réseau",
    ],
    chain: ["infrastructure", "adaptateurs", "cas-usage", "entites"],
    files_for_example: [
      "entites/livre",
      "cas-usage/lire-livre",
      "adaptateurs/depot-livres",
      "adaptateurs/controleur-livres",
      "infrastructure/sqlite",
      "+ des objets de transfert à chaque frontière",
    ],
    cost: "Le plus élevé. Un fichier par action, et des objets recopiés à chaque passage de frontière.",
    buys: "Les règles métier se lisent sans rien connaître du framework. Changer de framework devient presque gratuit.",
    wrong_when: "Quand le métier est mince. On obtient des cas d'usage qui appellent une méthode et des objets qui recopient des lignes : toute la cérémonie, aucun bénéfice.",
    verdict: "Pour un métier dense, discuté, destiné à durer des années. Rarement le bon choix pour une première version.",
  },
  {
    id: "onion",
    grows_into: "Même situation que Clean.",
    migration_triggers: ["Vos services de domaine sont vides → même symptôme, même impasse."],
    migration_cost: "Aussi difficile à quitter que Clean.",
    layers: { modele: ["src/domain/**", "src/model/**"], services: ["src/services/**"], infrastructure: ["src/infrastructure/**"] },
    allowed: { infrastructure: ["services", "modele"], services: ["modele"], modele: [] },
    name: "Onion",
    applies: ["backend", "fullstack"],
    plain: "Comme Clean, avec une couche de moins. Le modèle au centre, les services autour, la technique à l'extérieur.",
    tree: ["src/", "├── modele/         objets et règles", "├── services/       ce qu'on fait avec", "└── infrastructure/ base, réseau"],
    chain: ["infrastructure", "services", "modele"],
    files_for_example: ["modele/livre", "services/livres", "infrastructure/sqlite/depot-livres", "infrastructure/http/controleur"],
    cost: "Proche de Clean, un étage en moins à nommer.",
    buys: "La même isolation du métier, avec moins de fichiers de passage.",
    wrong_when: "Mêmes conditions que Clean.",
    verdict: "Si vous hésitez entre Clean et Onion, le problème n'est pas là : c'est que vous n'êtes pas sûr d'avoir besoin de l'une des deux.",
  },
  {
    id: "feature-sliced",
    grows_into: "Les étages absorbent la croissance : on ajoute des fonctionnalités, pas des étages.",
    migration_triggers: ["Un étage devient énorme → c'est un découpage interne à revoir, pas l'architecture."],
    migration_cost: "Faible. Le modèle est fait pour grossir, c'est son objet.",
    layers: { pages: ["src/pages/**", "src/app/**"], fonctions: ["src/features/**"], entites: ["src/entities/**"], "partagé": ["src/shared/**"] },
    allowed: { pages: ["fonctions", "entites", "partagé"], fonctions: ["entites", "partagé"], entites: ["partagé"], "partagé": [] },
    name: "Découpage en tranches",
    applies: ["frontend"],
    plain: "Des étages ordonnés : les pages en haut, puis les fonctionnalités, puis les objets métier, puis le partagé. Un étage n'utilise que les étages du dessous.",
    tree: [
      "src/",
      "├── pages/          un dossier par écran",
      "├── fonctions/      « emprunter », « rendre »",
      "├── entites/        livre, adhérent",
      "└── partagé/        boutons, appels réseau",
    ],
    chain: ["pages", "fonctions", "entites", "partagé"],
    files_for_example: ["pages/livre", "entites/livre/carte", "partagé/api"],
    cost: "Faible, mais demande de la rigueur : la règle ne tient que si chacun sait à quel étage appartient ce qu'il écrit.",
    buys: "Plus d'imports circulaires dans une base où tout tend à tout importer. Supprimer une fonctionnalité redevient possible.",
    wrong_when: "Sur une interface de quelques écrans : il y a plus d'étages que de fonctionnalités.",
    verdict: "Le plus solide pour une interface web destinée à grossir. Excessif en dessous d'une dizaine d'écrans.",
  },
  {
    id: "mvvm",
    grows_into: "Se combine avec un découpage par fonctionnalité quand le nombre d'écrans augmente.",
    migration_triggers: ["Un modèle de vue devient un fourre-tout → il manque une couche en dessous, pas un autre patron."],
    migration_cost: "Faible. MVVM se superpose, il ne se remplace pas.",
    layers: { ecrans: ["src/ui/**", "src/**/*.view.*"], "modeles-vue": ["src/**/*.viewmodel.*"], modele: ["src/domain/**", "src/model/**"] },
    allowed: { ecrans: ["modeles-vue"], "modeles-vue": ["modele"], modele: [] },
    name: "MVVM",
    applies: ["frontend", "mobile"],
    plain: "L'écran n'a aucune logique. Il regarde un objet qui prépare tout ce qu'il doit afficher, et cet objet ne connaît pas l'écran.",
    tree: ["src/", "├── ecrans/         ce qui s'affiche, sans logique", "├── modeles-vue/    prépare ce qu'on affiche", "└── modele/         les données"],
    chain: ["ecrans", "modeles-vue", "modele"],
    files_for_example: ["ecrans/livre", "modeles-vue/livre", "modele/livre"],
    cost: "Faible. C'est souvent ce que le framework impose déjà.",
    buys: "La logique d'écran se teste sans lancer l'interface. C'est le gain le plus rentable en mobile.",
    wrong_when: "Quand le modèle de vue devient le fourre-tout où atterrit toute la logique métier, faute d'une couche en dessous.",
    verdict: "À combiner avec un découpage par fonctionnalité. Jamais seul sur un projet qui grossit.",
  },
  {
    id: "mvi",
    grows_into: "Se combine aussi, écran par écran.",
    migration_triggers: ["Des écrans simples portent la même machinerie que les compliqués → appliquez-le seulement là où l'état le mérite."],
    migration_cost: "Faible, et réversible écran par écran.",
    layers: { ecrans: ["src/ui/**"], etat: ["src/state/**", "src/store/**"], modele: ["src/domain/**"] },
    allowed: { ecrans: ["etat"], etat: ["modele"], modele: [] },
    name: "MVI (état unidirectionnel)",
    applies: ["frontend", "mobile"],
    plain: "L'écran a un état complet à un instant donné. Chaque geste produit un nouvel état, jamais une modification de l'ancien. L'affichage n'est qu'une fonction de cet état.",
    tree: ["src/", "├── ecrans/         affiche l'état", "├── etat/           états et gestes", "└── modele/         les données"],
    chain: ["ecrans", "etat", "modele"],
    files_for_example: ["etat/livre-etat", "etat/livre-gestes", "ecrans/livre", "modele/livre"],
    cost: "Modéré. Beaucoup de types à déclarer, et un détour entre le geste et son effet.",
    buys: "Un bug se rejoue en rejouant la suite des gestes. Décisif en mobile, où le système détruit et recrée les écrans.",
    wrong_when: "Sur des écrans simples : la machinerie coûte plus cher que l'état qu'elle protège.",
    verdict: "Pour les écrans à état compliqué : formulaires longs, synchronisation, mode hors ligne.",
  },
];

/**
 * Ce qui traverse la frontiere entre deux produits d'un meme depot.
 *
 * Sur un depot full-stack, cette question decide de ce qui casse quand un
 * cote bouge. Elle compte plus que la structure interne de chaque cote.
 */
export const FULLSTACK_BOUNDARY = [
  {
    option: "Le back génère les types, le front les utilise",
    cost: "Une étape de génération, et une porte qui refuse un contrat périmé.",
    buys: "Le front ne compile plus si le back a changé son contrat. La rupture apparaît à la compilation, pas chez l'utilisateur.",
    wrong_when: "Quand les deux côtés sont livrés séparément : le front doit alors tolérer une version plus ancienne du back.",
  },
  {
    option: "Un dossier de types communs, écrit à la main",
    cost: "Presque rien, mais la synchronisation repose sur la vigilance.",
    buys: "Simple et lisible, sans outillage.",
    wrong_when: "Dès que le contrat change souvent : le dossier commun devient faux sans que rien ne le signale.",
  },
  {
    option: "Aucun partage, le front redéclare ce qu'il consomme",
    cost: "De la duplication assumée.",
    buys: "Chaque côté évolue et se livre seul. Le front déclare exactement ce dont il a besoin.",
    wrong_when: "Quand une seule équipe tient les deux côtés : on duplique sans gagner l'indépendance qui le justifierait.",
  },
];
