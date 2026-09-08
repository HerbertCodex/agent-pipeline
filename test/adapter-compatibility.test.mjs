import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("Nest 12 remains outside support while its complete setup battery is red", () => {
  const nest12 = {
    node: "22.23.2", manager: "npm", manager_version: "11.19.0",
    packages: { "@nestjs/core": "12.0.1", "@nestjs/common": "12.0.1", "@nestjs/cli": "12.0.0",
      typescript: "6.0.3", vitest: "4.1.11", oxlint: "1.82.0" },
  };
  assert.equal(assessCompatibility(manifest, nest12).status, "unsupported");
  assert.equal(assessCompatibility(manifest, { ...nest12, packages: { ...nest12.packages, typescript: "7.0.0" } }).status, "unsupported");
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
  broken.supported[0].node.max_exclusive = "25.0.0";
  assert.throws(() => validateManifest(broken), /runtime dependency/);
});
