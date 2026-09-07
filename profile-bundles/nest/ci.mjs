import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { runStep } from "../../scripts/setup-runner.mjs";
import { assessCompatibility, validateManifest } from "../../scripts/adapter-compatibility.mjs";

const framework = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = validateManifest(JSON.parse(readFileSync(new URL("./compatibility.json", import.meta.url), "utf8")));
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function observed(root) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const runner = pkg.scripts.test.split(" ")[0];
  const linter = pkg.scripts.lint.split(" ")[0];
  const required = ["@nestjs/core", "@nestjs/common", "@nestjs/cli", "typescript", runner, linter];
  const packages = Object.fromEntries(required.map((name) => [name, JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8")).version]));
  return { node: process.versions.node, manager: "npm", manager_version: execFileSync("npm", ["--version"], { encoding: "utf8", timeout: 30000 }).trim(), required, packages };
}

function exactRange(value) {
  if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error(`Probe requires a stable version: ${value}`);
  const parts = value.split(".").map(Number);
  return { min: value, max_exclusive: `${parts[0]}.${parts[1]}.${parts[2] + 1}` };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--matrix") {
    console.log(JSON.stringify({ include: manifest.supported.map((entry) => ({ id: entry.id, ...entry.reference })) }));
    return;
  }
  if (args.length !== 4 || args[0] !== "--case" || args[2] !== "--output") throw new Error("usage: ci.mjs --matrix | --case <id|latest> --output <directory>");
  const id = args[1];
  const candidate = id === "latest";
  const entry = manifest.supported.find((item) => item.id === id);
  if (!candidate && !entry) throw new Error(`Unknown compatibility case: ${id}`);
  const output = resolve(args[3]);
  mkdirSync(output, { recursive: true });
  const temporary = mkdtempSync(join(tmpdir(), "pipeline-compatibility-"));
  const host = join(temporary, "app");
  const report = { case: id, candidate_only: candidate, adapter_version: manifest.adapter_version, status: "running", steps: [] };
  async function step(name, command, args, cwd = host) {
    const result = await runStep(name, command, args, { cwd, timeoutMs: 600000 });
    report.steps.push(result);
    if (result.code !== 0 || result.timed_out || result.interrupted || result.error) throw new Error(`Compatibility probe failed: ${name}`);
  }
  try {
    const cli = candidate ? execFileSync("npm", ["view", "@nestjs/cli", "version"], { encoding: "utf8", timeout: 30000 }).trim() : entry.reference.cli;
    exactRange(cli);
    report.scaffold_cli = cli;
    await step("generate official Nest scaffold", "npm", ["exec", "--yes", `--package=@nestjs/cli@${cli}`, "--", "nest", "new", "app", "--package-manager", "npm", "--skip-git", "--strict"], temporary);
    report.installed = observed(host);
    report.released_compatibility = assessCompatibility(manifest, report.installed);
    const copy = join(host, "agent-pipeline");
    mkdirSync(copy);
    for (const name of ["scripts", "templates", "schemas", "prompts", "docs", "skills", "profile-bundles", "pages", "VERSION"]) cpSync(join(framework, name), join(copy, name), { recursive: true });
    if (candidate) {
      console.log("EXPERIMENTAL latest probe: admission is extended only inside this disposable framework copy. No released support declaration changes.");
      const installed = report.installed;
      const trial = { ...manifest, experimental: true, supported: [{
        id: "latest-candidate", node: exactRange(installed.node), manager: "npm", manager_version: exactRange(installed.manager_version),
        packages: Object.fromEntries(Object.entries(installed.packages).map(([name, value]) => [name, exactRange(value)])),
        reference: { node: installed.node, cli, manager_version: installed.manager_version }, evidence: "Candidate probe only",
      }] };
      writeFileSync(join(copy, "profile-bundles/nest/compatibility.json"), json(trial));
    } else if (report.released_compatibility.status !== "compatible") throw new Error("Generated reference dependencies moved outside the declared contract; inspect the recorded versions.");
    await step("initialize Git", "git", ["init", "-q"]);
    await step("install pipeline", process.execPath, ["agent-pipeline/scripts/setup.mjs", "--runtime", "claude-code"]);
    await step("prove gate refusals", process.execPath, ["agent-pipeline/profile-bundles/nest/verify.mjs"]);
    await step("verify healthy rerun", process.execPath, ["agent-pipeline/scripts/setup.mjs"]);
    const configPath = join(host, "pipeline.config.json");
    const localConfig = JSON.parse(readFileSync(configPath, "utf8"));
    localConfig.language = "fr";
    writeFileSync(configPath, json(localConfig));
    const manifestPath = join(copy, "profile-bundles/nest/compatibility.json");
    const update = JSON.parse(readFileSync(manifestPath, "utf8"));
    const versionParts = update.adapter_version.split(".").map(Number);
    update.adapter_version = `${versionParts[0]}.${versionParts[1]}.${versionParts[2] + 1}`;
    writeFileSync(manifestPath, json(update));
    const preview = JSON.parse(execFileSync(process.execPath, ["agent-pipeline/scripts/setup.mjs", "--update"], { cwd: host, encoding: "utf8", timeout: 30000 }));
    assert.equal(preview.config.language, "fr");
    assert.equal(JSON.parse(readFileSync(configPath, "utf8")).setup.adapter_version, manifest.adapter_version);
    writeFileSync(join(output, "migration-preview.json"), json(preview.update));
    await step("update adapter preserving local configuration", process.execPath, ["agent-pipeline/scripts/setup.mjs", "--update", "--apply"]);
    const updated = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(updated.language, "fr");
    assert.equal(updated.setup.adapter_version, update.adapter_version);
    report.migration = { to: update.adapter_version, preserved_language: updated.language };
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    for (const path of ["package.json", "package-lock.json", "pipeline/setup-report.json"]) {
      if (existsSync(join(host, path))) cpSync(join(host, path), join(output, path.replaceAll("/", "-")));
    }
    writeFileSync(join(output, "result.json"), json(report));
    console.log(`Compatibility ${report.status}; evidence: ${output}`);
    rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
