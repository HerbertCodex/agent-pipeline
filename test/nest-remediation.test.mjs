import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { plan } from "../profile-bundles/nest/installer.mjs";
import { chdirToFramework } from "./framework-root.mjs";

chdirToFramework();

const roots = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

const manifest = JSON.parse(readFileSync(new URL("../profile-bundles/nest/compatibility.json", import.meta.url), "utf8"));
const defaults = () => JSON.parse(readFileSync(resolve("templates/pipeline.config.template.json"), "utf8"));

/** A Nest 12 scaffold as the official CLI generates it, deploy helper included. */
function scaffold({ mau = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "nest-remediation-"));
  roots.push(root);
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "test"));
  writeFileSync(join(root, "src/main.ts"), "export const bootstrap = () => {};\n");
  writeFileSync(join(root, "nest-cli.json"), JSON.stringify({ sourceRoot: "src" }));
  writeFileSync(join(root, "tsconfig.json"), "{}");
  writeFileSync(join(root, "package-lock.json"), "{}");
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "app",
    version: "0.0.1",
    dependencies: { "@nestjs/core": "^12.0.1", "@nestjs/common": "^12.0.1", "@nestjs/platform-express": "^12.0.1" },
    devDependencies: {
      typescript: "^6.0.2", vitest: "^4.1.2", oxlint: "^1.58.0", "@nestjs/cli": "^12.0.0",
      ...(mau ? { "@nestjs/mau": "^0.2.6" } : {}),
    },
    scripts: {
      build: "nest build", lint: "oxlint src/ test/", test: "vitest run",
      "test:e2e": "vitest run --config ./vitest.config.e2e.ts",
      ...(mau ? { deploy: "nest deploy" } : {}),
    },
  }, null, 2));
  return root;
}

describe("Nest scaffold remediation", () => {
  test("repairs what the audit gate would refuse, and says exactly what it changed", () => {
    const planned = plan(scaffold(), defaults());
    assert.ok(planned.remediation, "the plan carries no remediation");

    const applied = planned.remediation.applied.map((entry) => entry.id).sort();
    assert.deepEqual(applied, ["drop-deploy-helper", "multer-fixed-release"]);
    for (const entry of planned.remediation.applied) {
      const declared = manifest.remediations.find((item) => item.id === entry.id);
      assert.ok(declared, `${entry.id} is applied without being declared in the manifest`);
      assert.ok(declared.advisories.length > 0, `${entry.id} names no advisory`);
    }

    const pkg = JSON.parse(planned.remediation.package_json);
    // The advisory is repaired, not silenced: 2.3.0 is the fixed release.
    assert.equal(pkg.overrides.multer, "2.3.0");
    // No fixed release exists for the deploy helper's chain, so it goes.
    assert.equal(pkg.devDependencies["@nestjs/mau"], undefined);
    assert.equal(pkg.scripts.deploy, undefined);
    // Everything the project owns survives untouched.
    assert.equal(pkg.name, "app");
    assert.equal(pkg.scripts.build, "nest build");
    assert.equal(pkg.dependencies["@nestjs/core"], "^12.0.1");
    assert.equal(pkg.devDependencies.vitest, "^4.1.2");

    // An override only reaches the audit through a regenerated lockfile.
    assert.deepEqual(planned.remediation.install, { command: "npm", args: ["install"] });
  });

  test("a scaffold that needs nothing is left alone", () => {
    const root = scaffold({ mau: false });
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    pkg.overrides = { multer: "2.3.0" };
    writeFileSync(join(root, "package.json"), JSON.stringify(pkg, null, 2));
    const planned = plan(root, defaults());
    assert.equal(planned.remediation, null, "an already repaired scaffold must not be rewritten");
  });
});

describe("Nest adapter calibration evidence", () => {
  test("the plan records the toolchain the gates will be proven against", () => {
    const planned = plan(scaffold(), defaults());
    assert.ok(planned.detected, "the plan records nothing about the toolchain it observed");
    // Setup clears calibration_required once the gates pass. That claim is
    // refused by apply-profile unless it says against what, so the adapter
    // has to carry its observation rather than assert a bare flag.
    assert.equal(planned.detected.manager, "npm");
    assert.equal(planned.detected.test_runner, "vitest");
    assert.equal(planned.detected.linter, "oxlint");
    assert.equal(planned.detected.node, process.versions.node);
    assert.ok("packages" in planned.detected);
  });
});
