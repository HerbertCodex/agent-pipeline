import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { assessCompatibility, inRange, validateManifest } from "../scripts/adapter-compatibility.mjs";

const manifest = JSON.parse(readFileSync(new URL("../profile-bundles/nest/compatibility.json", import.meta.url), "utf8"));
const installed = {
  node: manifest.supported[0].reference.node, manager: "npm", manager_version: "11.19.0",
  packages: { "@nestjs/core": "11.2.3", "@nestjs/common": "11.2.3", "@nestjs/cli": "11.0.24", typescript: "5.9.3", jest: "30.5.1", eslint: "9.39.5" },
};

test("compatibility uses actual installed versions, including bounded patch upgrades", () => {
  assert.equal(assessCompatibility(manifest, installed).status, "compatible");
  assert.equal(assessCompatibility(manifest, { ...installed, packages: { ...installed.packages, "@nestjs/core": "11.2.4" } }).status, "compatible");
  for (const [name, version] of [["@nestjs/core", "12.0.1"], ["typescript", "6.0.2"], ["jest", "31.0.0"], ["eslint", "10.0.0"]]) {
    assert.equal(assessCompatibility(manifest, { ...installed, packages: { ...installed.packages, [name]: version } }).status, "unsupported", name);
  }
});

test("Nest 12 is admitted at the versions that were probed, and refused beyond them", () => {
  const nest12 = {
    node: "22.23.2", manager: "npm", manager_version: "11.19.0",
    packages: { "@nestjs/core": "12.0.1", "@nestjs/common": "12.0.1", "@nestjs/cli": "12.0.0",
      typescript: "6.0.3", vitest: "4.1.11", oxlint: "1.82.0" },
  };
  assert.equal(assessCompatibility(manifest, nest12).status, "compatible");
  // Admission stops at what was measured. TypeScript 7 was never probed, so
  // it is refused rather than assumed to behave like the version that was.
  assert.equal(assessCompatibility(manifest, { ...nest12, packages: { ...nest12.packages, typescript: "7.0.0" } }).status, "unsupported");
  assert.equal(assessCompatibility(manifest, { ...nest12, packages: { ...nest12.packages, "@nestjs/core": "13.0.0" } }).status, "unsupported");
});

test("missing versions stay unverified and prereleases do not enter stable support", () => {
  assert.equal(assessCompatibility(manifest, { ...installed, packages: {} }).status, "unverified");
  assert.equal(assessCompatibility(manifest, { ...installed, node: "25.0.0" }).status, "unsupported");
  assert.equal(assessCompatibility(manifest, { ...installed, manager: "pnpm", manager_version: "10.0.0" }).status, "unsupported");
  assert.equal(inRange("11.3.0-rc.1", { min: "11.2.3", max_exclusive: "12.0.0" }), false);
  assert.equal(inRange("12.0.0", { min: "11.2.3", max_exclusive: "12.0.0" }), false);
});

test("malformed compatibility manifests fail closed", () => {
  assert.throws(() => validateManifest({}), /manifest/);
  const broken = structuredClone(manifest);
  broken.supported[0].node.max_exclusive = broken.supported[0].node.min;
  assert.throws(() => validateManifest(broken), /range/);
});

test("supported runtimes cannot exceed a native setup prerequisite", () => {
  assert.doesNotThrow(() => validateManifest(manifest));
  const broken = structuredClone(manifest);
  // Derived, not written down: a literal here silently stops exceeding the
  // range the day the prerequisite admits a newer runtime, and the test then
  // passes by measuring nothing.
  const admitted = manifest.runtime_dependencies[0].node.max_exclusive;
  broken.supported[0].node.max_exclusive = `${Number(admitted.split(".")[0]) + 1}.0.0`;
  assert.throws(() => validateManifest(broken), /runtime dependency/);
});

test("a runtime declared supported comes with a package manager the same case admits", () => {
  const admitting = manifest.supported.filter((entry) => inRange(process.versions.node, entry.node));
  if (admitting.length === 0) return;

  // Node 22.23.2 ships npm 10.9.8 while its case demanded 11.19.0: no runtime
  // in the declared range could satisfy the declared toolchain. The fixture
  // suite then failed on the environment and reported it as a defect of the
  // code under test.
  const installed = execFileSync("npm", ["--version"], { encoding: "utf8", timeout: 30000 }).trim();
  const admitted = admitting.some((entry) => inRange(installed, entry.manager_version));
  assert.ok(
    admitted,
    `this runtime is declared supported but its npm ${installed} is outside every admitting case: ` +
      `${admitting.map((entry) => `${entry.id} wants ${entry.manager_version.min}`).join(", ")}`,
  );
});
