import { pageText } from "./page.mjs";

/**
 * Project types recognised at configuration time.
 *
 * The type changes the answer, not merely the vocabulary: talking about
 * ports and adapters to a web interface does not mean what it means to a
 * service speaking to three databases. An option presented outside the
 * project type is a catalogue, not help with a decision.
 */
export const PROJECT_TYPES = {
  backend: {
    label: "Back-end service",
    blurb: "An API with no interface. What will move: data sources, integrations. Rarely the screens, there are none.",
    example: "add a route that reads a book",
  },
  frontend: {
    label: "Web interface",
    blurb: "An application in a browser. What will move: screens and journeys. Almost never the source of the data.",
    example: "add a screen that shows a book",
  },
  mobile: {
    label: "Mobile application",
    blurb: "A native application. What will move: screens and local state, under intermittent connectivity.",
    example: "add a screen that shows a book",
  },
  fullstack: {
    label: "Front and back in one repository",
    blurb: "Two products, one repository. The real question is not their internal structure but what passes between them.",
    example: "show a book, from the database to the screen",
  },
};

/**
 * The questions that decide, before any architecture is named.
 *
 * An operator who chooses by name chooses by fashion. These questions are
 * answered without knowing a single architecture, and their answers
 * eliminate most options before anyone names them.
 */
export const DECISION_AXIS = [
  {
    question: "Are you really going to replace your database?",
    short: "Almost always: no.",
    why: "This is the question that eliminates the most options. Some architectures exist so you can change database without touching the rest. That is paid for on every route you write. If you will never change it, you are paying for insurance you will not claim.",
    answers: [
      ["No, never", "Set hexagonal and Clean aside. You do not have the problem they solve."],
      ["Maybe a third-party service", "Isolate that one service. Not the rest."],
      ["Yes, that is the business", "Hexagonal is genuinely justified. That is rare."],
    ],
  },
  {
    question: "Would your business rules survive a complete change of technology?",
    short: "Is there a domain, or just data?",
    why: "Some architectures isolate business rules from everything else. That still requires rules to exist. A service that reads a table and returns it as JSON has no domain: it has a schema. Adding a domain layer to it creates files that copy rows around.",
    answers: [
      ["We move data and validate it", "A folder per feature is more than enough."],
      ["A few rules that matter", "Isolate those rules. Not the whole model."],
      ["Dense rules, discussed with the business", "Clean or Onion start to make sense."],
    ],
  },
  {
    question: "How many people or agents will work on it at the same time?",
    short: "Alone, optimise for cohesion. With several, for parallel work.",
    why: "Arranging by technical layer puts everyone in the same folders: every feature crosses every layer. Arranging by feature gives each person their own folder. This is the most concrete of the four criteria.",
    answers: [
      ["One person at a time", "Layered stays readable."],
      ["Two to five", "Arrange by feature. One folder each."],
      ["Several teams", "Autonomous modules with contracts between them."],
    ],
  },
  {
    question: "In your previous projects, what changed most often?",
    short: "Put what moves least at the centre.",
    why: "An architecture protects whatever it places at the centre. The classic mistake is protecting what never moves and leaving at the edge what changes every week. You only notice after two years.",
    answers: [
      ["Screens and journeys", "Arrange by feature, not by layer."],
      ["The business rules", "Isolate them, with tests that know no technology."],
      ["External integrations", "That is where, and only where, ports are justified."],
    ],
  },
];

/**
 * The architecture catalogue.
 *
 * `layers` and `allowed` are not decorative: they are exactly the fields
 * the declaration will carry in the configuration. The operator therefore
 * reads what the gate will enforce.
 */
export const ARCHITECTURES = [
  {
    id: "feature-modules",
    grows_into: "A module whose rules grow dense hardens on its own, without touching the others.",
    migration_triggers: [
      "The same business rule appears in two modules -> pull it into a shared module, once.",
      "You really must replace one integration -> put a port on that one, not on the rest.",
      "A module passes a dozen rules discussed with the business -> isolate ITS domain, that one alone.",
    ],
    migration_cost: "Low and local. You harden one folder at a time, the others do not move. It is the only option you can leave piece by piece.",
    layers: { shared: ["src/shared/**"], features: ["src/*/**"] },
    allowed: { features: ["shared"], shared: [] },
    name: "A folder per feature",
    applies: ["backend", "frontend", "mobile", "fullstack"],
    plain: "Everything about books lives in the « books » folder. Everything about loans lives in « loans ». You do not arrange by technical nature.",
    tree: ["src/", "|-- catalog/       everything about books", "|-- loans/         everything about lending", "`-- shared/        what both use"],
    chain: ["catalog", "shared"],
    files_for_example: ["catalog/service", "catalog/controller", "catalog/tests"],
    cost: "Almost nothing. One rule only: a folder does not rummage inside another, it goes through what the other publishes.",
    buys: "Two people work without colliding. Removing a feature means removing a folder.",
    wrong_when: "When two features share many rules: they end up copied, or the « shared » folder becomes the dumping ground.",
    verdict: "The reasonable default. Start here. You climb into abstraction when a precise pain demands it, not before.",
  },
  {
    id: "layered",
    grows_into: "Moving to a per-feature split means moving almost every file.",
    migration_triggers: [
      "Two people regularly get in each other's way in the same folders -> the split is already wrong.",
      "You spend a long time looking for where to put a new rule -> the layer says nothing about the subject.",
    ],
    migration_cost: "High and global. Every feature is scattered across three folders: you do not migrate piece by piece.",
    layers: { controllers: ["src/**/*.controller.*"], services: ["src/**/*.service.*"], data: ["src/persistence/**", "src/**/*.repository.*"] },
    allowed: { controllers: ["services"], services: ["data"], data: [] },
    name: "Arranged by technical layer",
    applies: ["backend", "fullstack"],
    plain: "All controllers together, all services together, all data access together. You arrange by nature, not by subject.",
    tree: ["src/", "|-- controllers/   receive the requests", "|-- services/      the logic", "`-- data/          talk to the database"],
    chain: ["controllers", "services", "data"],
    files_for_example: ["controllers/books", "services/books", "data/books"],
    cost: "Low, and familiar. Three folders, one rule about direction.",
    buys: "Everything has an obvious place. A newcomer knows where to look.",
    wrong_when: "As soon as several people work on it. A single feature touches all three folders, so everyone edits the same places.",
    verdict: "Honest for a one-person project. It is the layout that parallelises worst.",
  },
  {
    id: "hexagonal",
    grows_into: "Nothing pushes you out of it: you keep the ceremony, even once it serves nothing.",
    migration_triggers: ["You have not replaced a single adapter in two years -> the cost was paid for nothing, but nobody removes ports."],
    migration_cost: "There is no going back. You live with it. That is why this choice is made late, not early.",
    layers: { domain: ["src/domain/**"], application: ["src/application/**"], adapters: ["src/adapters/**", "src/infrastructure/**"] },
    allowed: { adapters: ["application", "domain"], application: ["domain"], domain: [] },
    name: "Hexagonal (ports and adapters)",
    applies: ["backend", "fullstack"],
    plain: "The core of the software says « I need someone who knows how to store a book » without knowing whether that is a database, a file or a remote service. You plug one or the other in behind it.",
    tree: [
      "src/",
      "|-- domain/         the rules, no technology",
      "|   `-- ports/      « I need someone who… »",
      "|-- application/    orchestrates the rules",
      "`-- adapters/       the real database, the real HTTP",
    ],
    chain: ["adapters", "application", "domain"],
    files_for_example: [
      "domain/book (the object)",
      "domain/ports/book-repository (the interface)",
      "application/read-book (the use case)",
      "adapters/sqlite/book-repository (the implementation)",
      "adapters/http/book-controller",
      "+ a fake repository for the tests",
    ],
    cost: "High, and every single time. Six files where three were enough. Half of them only pass information from one floor to the next.",
    buys: "Change database without touching the rules. Test the rules with no database at all. Real, but only on the day you actually change.",
    wrong_when: "When you will change nothing. A database chosen once is not a plug, it is a decision. The interface around it then serves nobody.",
    verdict: "Justified when plugging different systems together IS the business. Over-engineering everywhere else, and everywhere else is the common case.",
  },
  {
    id: "clean",
    grows_into: "Like hexagonal: you do not remove layers, you endure them.",
    migration_triggers: ["Your use cases only call one method -> the layer carries nothing, but removing it touches everything."],
    migration_cost: "The hardest in the catalogue to leave. Reserve it for domains you know are dense BEFORE you start.",
    layers: { entities: ["src/entities/**", "src/domain/**"], usecases: ["src/usecases/**"], adapters: ["src/adapters/**"], infrastructure: ["src/infrastructure/**"] },
    allowed: { infrastructure: ["adapters", "usecases", "entities"], adapters: ["usecases", "entities"], usecases: ["entities"], entities: [] },
    name: "Clean Architecture",
    applies: ["backend", "mobile", "fullstack"],
    plain: "Nested circles. Business objects at the centre, use cases around them, then the plugs, then the framework. Everything points inward, never the reverse.",
    tree: [
      "src/",
      "|-- entities/       pure business objects",
      "|-- usecases/       one file per action",
      "|-- adapters/       translate towards the outside",
      "`-- infrastructure/ database, framework, network",
    ],
    chain: ["infrastructure", "adapters", "usecases", "entities"],
    files_for_example: [
      "entities/book",
      "usecases/read-book",
      "adapters/book-repository",
      "adapters/book-controller",
      "infrastructure/sqlite",
      "+ transfer objects at every boundary",
    ],
    cost: "The highest. One file per action, and objects copied at every boundary crossing.",
    buys: "The business rules read without knowing anything about the framework. Changing framework becomes almost free.",
    wrong_when: "When the domain is thin. You get use cases calling one method and objects copying rows: all the ceremony, no benefit.",
    verdict: "For a dense domain, discussed, meant to last years. Rarely the right call for a first version.",
  },
  {
    id: "onion",
    grows_into: "Same situation as Clean.",
    migration_triggers: ["Your domain services are empty -> same symptom, same dead end."],
    migration_cost: "As hard to leave as Clean.",
    layers: { model: ["src/domain/**", "src/model/**"], services: ["src/services/**"], infrastructure: ["src/infrastructure/**"] },
    allowed: { infrastructure: ["services", "model"], services: ["model"], model: [] },
    name: "Onion",
    applies: ["backend", "fullstack"],
    plain: "Like Clean, with one layer fewer. The model at the centre, the services around it, the technology on the outside.",
    tree: ["src/", "|-- model/          objects and rules", "|-- services/       what you do with them", "`-- infrastructure/ database, network"],
    chain: ["infrastructure", "services", "model"],
    files_for_example: ["model/book", "services/books", "infrastructure/sqlite/book-repository", "infrastructure/http/controller"],
    cost: "Close to Clean, one floor fewer to name.",
    buys: "The same isolation of the domain, with fewer pass-through files.",
    wrong_when: "Same conditions as Clean.",
    verdict: "If you are hesitating between Clean and Onion, that is not the problem: the problem is that you are not sure you need either.",
  },
  {
    id: "feature-sliced",
    grows_into: "The floors absorb growth: you add features, not floors.",
    migration_triggers: ["One floor becomes enormous -> that is an internal split to revisit, not the architecture."],
    migration_cost: "Low. The model is built to grow, that is its purpose.",
    layers: { pages: ["src/pages/**", "src/app/**"], features: ["src/features/**"], entities: ["src/entities/**"], shared: ["src/shared/**"] },
    allowed: { pages: ["features", "entities", "shared"], features: ["entities", "shared"], entities: ["shared"], shared: [] },
    name: "Feature-sliced",
    applies: ["frontend"],
    plain: "Ordered floors: pages at the top, then features, then business objects, then what is shared. A floor only uses the floors below it.",
    tree: [
      "src/",
      "|-- pages/          one folder per screen",
      "|-- features/       « borrow », « return »",
      "|-- entities/       book, member",
      "`-- shared/         buttons, network calls",
    ],
    chain: ["pages", "features", "entities", "shared"],
    files_for_example: ["pages/book", "entities/book/card", "shared/api"],
    cost: "Low, but it demands discipline: the rule only holds if everyone knows which floor what they write belongs to.",
    buys: "No more circular imports in a codebase where everything tends to import everything. Removing a feature becomes possible again.",
    wrong_when: "On an interface of a few screens: there are more floors than features.",
    verdict: "The most solid for a web interface meant to grow. Excessive below about ten screens.",
  },
  {
    id: "mvvm",
    grows_into: "Combines with a per-feature split as the number of screens grows.",
    migration_triggers: ["A view model becomes a dumping ground -> a layer below it is missing, not another pattern."],
    migration_cost: "Low. MVVM layers on top, it does not replace.",
    layers: { screens: ["src/ui/**", "src/**/*.view.*"], viewmodels: ["src/**/*.viewmodel.*"], model: ["src/domain/**", "src/model/**"] },
    allowed: { screens: ["viewmodels"], viewmodels: ["model"], model: [] },
    name: "MVVM",
    applies: ["frontend", "mobile"],
    plain: "The screen has no logic. It watches an object that prepares everything it must display, and that object knows nothing of the screen.",
    tree: ["src/", "|-- screens/        what is displayed, no logic", "|-- viewmodels/     prepare what is displayed", "`-- model/          the data"],
    chain: ["screens", "viewmodels", "model"],
    files_for_example: ["screens/book", "viewmodels/book", "model/book"],
    cost: "Low. It is often what the framework already imposes.",
    buys: "Screen logic is testable without launching the interface. It is the most profitable gain on mobile.",
    wrong_when: "When the view model becomes the dumping ground where all business logic lands, for want of a layer beneath it.",
    verdict: "To be combined with a per-feature split. Never alone on a project that grows.",
  },
  {
    id: "mvi",
    grows_into: "Also combines, screen by screen.",
    migration_triggers: ["Simple screens carry the same machinery as complicated ones -> apply it only where the state deserves it."],
    migration_cost: "Low, and reversible screen by screen.",
    layers: { screens: ["src/ui/**"], state: ["src/state/**", "src/store/**"], model: ["src/domain/**"] },
    allowed: { screens: ["state"], state: ["model"], model: [] },
    name: "MVI (unidirectional state)",
    applies: ["frontend", "mobile"],
    plain: "The screen has one complete state at any instant. Every gesture produces a new state, never a modification of the old one. The display is only a function of that state.",
    tree: ["src/", "|-- screens/        displays the state", "|-- state/          states and gestures", "`-- model/          the data"],
    chain: ["screens", "state", "model"],
    files_for_example: ["state/book-state", "state/book-gestures", "screens/book", "model/book"],
    cost: "Moderate. Many types to declare, and a detour between a gesture and its effect.",
    buys: "A bug is reproduced by replaying the sequence of gestures. Decisive on mobile, where the system destroys and recreates screens.",
    wrong_when: "On simple screens: the machinery costs more than the state it protects.",
    verdict: "For screens with complicated state: long forms, synchronisation, offline mode.",
  },
];

/**
 * What crosses the boundary between two products in one repository.
 *
 * On a full-stack repository this question decides what breaks when one
 * side moves. It matters more than the internal structure of either side.
 */
export const FULLSTACK_BOUNDARY = [
  {
    option: "The back end generates the types, the front end uses them",
    cost: "A generation step, and a gate that refuses a stale contract.",
    buys: "The front end stops compiling once the back end changes its contract. The break shows at compile time, not at the user.",
    wrong_when: "When the two sides ship separately: the front end must then tolerate an older version of the back end.",
  },
  {
    option: "A shared folder of types, written by hand",
    cost: "Almost nothing, but synchronisation rests on vigilance.",
    buys: "Simple and readable, with no tooling.",
    wrong_when: "As soon as the contract changes often: the shared folder becomes wrong with nothing to report it.",
  },
  {
    option: "No sharing, the front end redeclares what it consumes",
    cost: "Duplication, accepted.",
    buys: "Each side evolves and ships alone. The front end declares exactly what it needs.",
    wrong_when: "When a single team holds both sides: you duplicate without gaining the independence that would justify it.",
  },
];

/**
 * Merges the catalogue's structure with the text of the operator's language.
 *
 * The structure — ids, layers, allowed directions, which project types an
 * option applies to — is the same whatever language the reader uses, and it
 * is what the gates enforce. Only the prose moves.
 *
 * Keeping them apart is what lets a translation be added without touching a
 * single rule, and what lets a rule change without touching a translation.
 *
 * @param config - the project configuration, or null
 * @returns the catalogue, its prose in the declared language
 */
export function catalogue(config) {
  const text = pageText(config);
  return {
    projectTypes: Object.fromEntries(
      Object.entries(PROJECT_TYPES).map(([id, entry]) => [id, { ...entry, ...(text.project_types?.[id] ?? {}) }]),
    ),
    decisionAxis: DECISION_AXIS.map((axis, index) => {
      const translated = text.decision_axis?.[index];
      if (translated == null) return axis;
      return {
        ...axis,
        question: translated.question,
        short: translated.short,
        why: translated.why,
        answers: (translated.answers ?? []).map((answer) => [answer.label, answer.then]),
      };
    }),
    architectures: ARCHITECTURES.map((entry) => ({ ...entry, ...(text.architectures?.[entry.id] ?? {}) })),
  };
}
