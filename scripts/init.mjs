import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fail } from "./lib.mjs";
import { ARCHITECTURES, PROJECT_TYPES } from "./architectures.mjs";

const ANSWERS_PATH = "pipeline.bootstrap.json";
const CONFIG_PATH = "pipeline.config.json";
const DECISION_PATH = "docs/decisions/0000-bootstrap.md";
const FRAMEWORK_VERSION = readFileSync(new URL("../VERSION", import.meta.url), "utf8").trim();

function text(value, key) {
  if (typeof value !== "string" || value.trim().length === 0) fail(`bootstrap.${key} must be a non-empty string`);
  return value.trim();
}

function answersValid(input) {
  if (input == null || typeof input !== "object" || Array.isArray(input)) fail("bootstrap answers must be an object");
  const product = text(input.product, "product");
  const projectType = text(input.architecture?.project_type, "architecture.project_type");
  if (!PROJECT_TYPES.includes(projectType)) {
    fail(`bootstrap.architecture.project_type must be one of ${PROJECT_TYPES.join(", ")}`);
  }
  const architectureId = text(input.architecture?.id, "architecture.id");
  const available = ARCHITECTURES.filter((entry) => entry.applies.includes(projectType)).map((entry) => entry.id);
  if (architectureId !== "custom" && !available.includes(architectureId)) {
    fail(`bootstrap.architecture.id must be one of ${[...available, "custom"].join(", ")} for ${projectType}`);
  }
  const architecture = { project_type: projectType, id: architectureId };
  if (architectureId === "custom") architecture.note = text(input.architecture?.note, "architecture.note");
  const stack = input.stack ?? {};
  if (typeof stack.imposed !== "boolean") fail("bootstrap.stack.imposed must be a boolean");
  const selected = typeof stack.selected === "string" ? stack.selected.trim() : "";
  if (stack.imposed && selected.length === 0) fail("bootstrap.stack.selected is required when the stack is imposed");
  const constraints = input.constraints ?? [];
  if (!Array.isArray(constraints) || constraints.some((value) => typeof value !== "string" || value.trim().length === 0)) {
    fail("bootstrap.constraints must be a list of non-empty strings");
  }
  return { product, constraints, stack: { imposed: stack.imposed, selected: selected || null }, architecture };
}

function markdown(answers) {
  const constraints = answers.constraints.length === 0 ? "- None declared." : answers.constraints.map((item) => `- ${item}`).join("\n");
  return `# Bootstrap decision\n\n` +
    `This record was written by \`init.mjs\`; it is the answer to the questions that cannot be inferred from a repository.\n\n` +
    `## Product\n\n${answers.product}\n\n` +
    `## Constraints\n\n${constraints}\n\n` +
    `## Stack\n\n- Imposed: ${answers.stack.imposed ? "yes" : "no"}\n` +
    `- Selected: ${answers.stack.selected ?? "to be recommended after source inspection"}\n\n` +
    `## Architecture\n\n- Project type: ${answers.architecture.project_type}\n- Layout: ${answers.architecture.id}\n\n` +
    `The installer now inspects the actual sources, selects or calibrates the stack profile, and completes \`pipeline.config.json\`.\n`;
}

async function interactiveAnswers() {
  const ui = createInterface({ input: stdin, output: stdout });
  try {
    const product = await ui.question("What product are you building? ");
    const constraints = (await ui.question("Constraints (comma-separated, blank for none): "))
      .split(",").map((value) => value.trim()).filter(Boolean);
    const imposed = (await ui.question("Is the stack imposed? (yes/no): ")).trim().toLowerCase();
    if (!["yes", "no", "y", "n"].includes(imposed)) fail("answer yes or no for stack.imposed");
    const stackImposed = imposed === "yes" || imposed === "y";
    const selected = stackImposed ? await ui.question("Which stack? ") : "";
    const projectType = await ui.question(`Project type (${PROJECT_TYPES.join(", ")}): `);
    const available = ARCHITECTURES.filter((entry) => entry.applies.includes(projectType.trim())).map((entry) => entry.id);
    const id = await ui.question(`Architecture (${[...available, "custom"].join(", ")}): `);
    const note = id.trim() === "custom" ? await ui.question("Describe the custom architecture: ") : undefined;
    return { product, constraints, stack: { imposed: stackImposed, selected }, architecture: { project_type: projectType, id, note } };
  } finally {
    ui.close();
  }
}

/**
 * Records bootstrap decisions before any agent selects a stack profile.
 *
 * Usage: node init.mjs [--answers answers.json]
 *
 * The file written is intentionally an incomplete pipeline configuration:
 * it proves the human choices, while `apply-profile` continues to refuse
 * execution until a real stack profile and commands exist.
 */
async function main() {
  const args = process.argv.slice(2);
  const index = args.indexOf("--answers");
  if (index !== -1 && args[index + 1] == null) fail("usage: init.mjs [--answers answers.json]");
  if (args.some((arg, position) => arg !== "--answers" && position !== index + 1)) {
    fail("usage: init.mjs [--answers answers.json]");
  }
  if (existsSync(CONFIG_PATH) || existsSync(ANSWERS_PATH) || existsSync(DECISION_PATH)) {
    fail(`bootstrap already exists: keep its decisions or remove ${CONFIG_PATH}, ${ANSWERS_PATH} and ${DECISION_PATH} deliberately`);
  }
  let raw;
  if (index === -1) raw = await interactiveAnswers();
  else {
    try {
      raw = JSON.parse(readFileSync(args[index + 1], "utf8"));
    } catch (error) {
      fail(`bootstrap answers unreadable: ${error.message}`);
    }
  }
  const answers = answersValid(raw);
  const bootstrap = { ...answers, framework_version: FRAMEWORK_VERSION, recorded_at: new Date().toISOString(), format: 1 };
  mkdirSync("docs/decisions", { recursive: true });
  writeFileSync(ANSWERS_PATH, `${JSON.stringify(bootstrap, null, 2)}\n`);
  writeFileSync(DECISION_PATH, markdown(answers));
  writeFileSync(CONFIG_PATH, `${JSON.stringify({ architecture: answers.architecture, bootstrap: ANSWERS_PATH }, null, 2)}\n`);
  console.log(`written: ${ANSWERS_PATH}`);
  console.log(`written: ${DECISION_PATH}`);
  console.log(`written: ${CONFIG_PATH} (bootstrap only; complete it with the proven stack profile)`);
}

if (process.argv[1]?.endsWith("init.mjs")) main();
