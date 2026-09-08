import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { measure, violations } from "./design.mjs";
import { scanSecrets } from "./secrets.mjs";
import { smoke } from "./smoke.mjs";

const require = createRequire(join(process.cwd(), "package.json"));
const config = JSON.parse(readFileSync("pipeline.config.json", "utf8"));
const setup = config.setup;

function execute(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Command failed: ${command} (exit ${result.status}, signal ${result.signal ?? "none"})`);
}

function binary(name, args) {
  const manifestPath = join(process.cwd(), "node_modules", name, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[name === "typescript" ? "tsc" : name];
  if (!bin) throw new Error(`${name} has no executable`);
  execute(process.execPath, [join(manifestPath, "..", bin), ...args]);
}

function design() {
  const ts = require("typescript");
  const results = [];
  let files = 0;
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && path.endsWith(".ts") && !/\.(?:spec|test|d)\.ts$/.test(path)) {
        files += 1;
        results.push(...violations(measure(ts, readFileSync(path, "utf8")), config.design_limits).map((item) => `${path}:${item}`));
      }
    }
  }
  walk("src");
  if (!files) throw new Error("No production TypeScript source to measure.");
  if (results.length) throw new Error(results.join("\n"));
  console.log(`design_limits: ${files} production file(s) satisfy the fixed preset bounds.`);
}

try {
  const gate = process.argv[2];
  if (gate === "check") binary("typescript", ["--noEmit", "--incremental", "false",
    ...(setup.test_runner === "vitest" ? ["--module", "Preserve", "--moduleResolution", "Bundler"] : [])]);
  else if (gate === "lint") binary(setup.linter, ["src", "test", ...(setup.linter === "eslint" ? ["--ext", ".ts"] : [])]);
  else if (gate === "build") execute(setup.package_manager, ["run", "build"]);
  else if (gate === "test_unit") binary(setup.test_runner, setup.test_runner === "jest" ? ["--runInBand"] : ["run"]);
  else if (gate === "test_e2e") execute(setup.package_manager, ["run", "test:e2e", ...(setup.test_runner === "jest" ? [...(setup.package_manager === "npm" ? ["--"] : []), "--runInBand"] : [])]);
  else if (gate === "audit") execute(setup.package_manager, setup.package_manager === "yarn" ? ["audit"] : ["audit", "--audit-level=high"]);
  else if (gate === "design_limits") design();
  else if (gate === "secrets_scan") scanSecrets();
  else if (gate === "smoke") await smoke(config.smoke);
  else throw new Error(`Unknown Nest gate: ${gate}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
