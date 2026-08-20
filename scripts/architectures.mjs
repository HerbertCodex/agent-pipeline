import { pageText } from "./page.mjs";

/**
 * Project types recognised at configuration time.
 *
 * The type changes the answer, not merely the vocabulary: talking about
 * ports and adapters to a web interface does not mean what it means to a
 * service speaking to three databases. An option presented outside the
 * project type is a catalogue, not help with a decision.
 */
export const PROJECT_TYPES = ["backend", "frontend", "mobile", "fullstack"];

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
    applies: ["backend", "frontend", "mobile", "fullstack"],
    layers: { shared: ["src/shared/**"], features: ["src/*/**"] },
    allowed: { features: ["shared"], shared: [] },
    chain: ["catalog", "shared"],
  },
  {
    id: "layered",
    applies: ["backend", "fullstack"],
    layers: {
      controllers: ["src/**/*.controller.*"],
      services: ["src/**/*.service.*"],
      data: ["src/persistence/**", "src/**/*.repository.*"],
    },
    allowed: { controllers: ["services"], services: ["data"], data: [] },
    chain: ["controllers", "services", "data"],
  },
  {
    id: "hexagonal",
    applies: ["backend", "fullstack"],
    layers: {
      domain: ["src/domain/**"],
      application: ["src/application/**"],
      adapters: ["src/adapters/**", "src/infrastructure/**"],
    },
    allowed: { adapters: ["application", "domain"], application: ["domain"], domain: [] },
    chain: ["adapters", "application", "domain"],
  },
  {
    id: "clean",
    applies: ["backend", "mobile", "fullstack"],
    layers: {
      entities: ["src/entities/**", "src/domain/**"],
      usecases: ["src/usecases/**"],
      adapters: ["src/adapters/**"],
      infrastructure: ["src/infrastructure/**"],
    },
    allowed: {
      infrastructure: ["adapters", "usecases", "entities"],
      adapters: ["usecases", "entities"],
      usecases: ["entities"],
      entities: [],
    },
    chain: ["infrastructure", "adapters", "usecases", "entities"],
  },
  {
    id: "onion",
    applies: ["backend", "fullstack"],
    layers: {
      model: ["src/domain/**", "src/model/**"],
      services: ["src/services/**"],
      infrastructure: ["src/infrastructure/**"],
    },
    allowed: { infrastructure: ["services", "model"], services: ["model"], model: [] },
    chain: ["infrastructure", "services", "model"],
  },
  {
    id: "feature-sliced",
    applies: ["frontend"],
    layers: {
      pages: ["src/pages/**", "src/app/**"],
      features: ["src/features/**"],
      entities: ["src/entities/**"],
      shared: ["src/shared/**"],
    },
    allowed: {
      pages: ["features", "entities", "shared"],
      features: ["entities", "shared"],
      entities: ["shared"],
      shared: [],
    },
    chain: ["pages", "features", "entities", "shared"],
  },
  {
    id: "mvvm",
    applies: ["frontend", "mobile"],
    layers: {
      screens: ["src/ui/**", "src/**/*.view.*"],
      viewmodels: ["src/**/*.viewmodel.*"],
      model: ["src/domain/**", "src/model/**"],
    },
    allowed: { screens: ["viewmodels"], viewmodels: ["model"], model: [] },
    chain: ["screens", "viewmodels", "model"],
  },
  {
    id: "mvi",
    applies: ["frontend", "mobile"],
    layers: { screens: ["src/ui/**"], state: ["src/state/**", "src/store/**"], model: ["src/domain/**"] },
    allowed: { screens: ["state"], state: ["model"], model: [] },
    chain: ["screens", "state", "model"],
  },
];

/**
 * What crosses the boundary between two products in one repository.
 *
 * On a full-stack repository this question decides what breaks when one
 * side moves. It matters more than the internal structure of either side.
 */
export const FULLSTACK_BOUNDARY = ["generated", "shared", "redeclared"];

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
    projectTypes: Object.fromEntries(PROJECT_TYPES.map((id) => [id, text.project_types[id]])),
    decisionAxis: text.decision_axis.map((axis) => ({
      question: axis.question,
      short: axis.short,
      why: axis.why,
      answers: (axis.answers ?? []).map((answer) => [answer.label, answer.then]),
    })),
    architectures: ARCHITECTURES.map((entry) => ({ ...entry, ...text.architectures[entry.id] })),
  };
}
