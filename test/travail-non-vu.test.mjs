import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createSandbox, destroySandbox, writeStore, run, issue, state } from "./harness.mjs";
import { unclaimed } from "../scripts/unclaimed.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

/**
 * Builds a repository with commits touching the source tree.
 *
 * @param commits - one entry per commit: the file it writes and its message
 * @returns the sandbox root and the shas produced, oldest first
 */
function repository(commits) {
  const root = createSandbox();
  const path = join(root, "pipeline.config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.project_map = { out: "docs/map.md", roots: ["src"], regenerate: "true" };
  writeFileSync(path, JSON.stringify(config, null, 2));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  mkdirSync(join(root, "src"), { recursive: true });
  const shas = [];
  for (const [file, message] of commits) {
    writeFileSync(join(root, file), `// ${message}\n`);
    git("add", "-A");
    git("commit", "-qm", message);
    shas.push(git("rev-parse", "HEAD").trim());
  }
  return { root, shas };
}

describe("the store knowing nothing of the work is itself reportable", () => {
  test("a commit touching the source that no issue claims is unclaimed", () => {
    // Observed on a real project: a whole feature built directly, the store
    // empty, and `next-step` answering « no step to run » — which reads as
    // « nothing to do » rather than « this pipeline has never seen this
    // repository ». The rule saying to ask first lived in CLAUDE.md and
    // nothing could refuse a session that did not.
    const { root } = repository([["src/a.ts", "add the expense port"]]);
    sandbox = root;
    const found = unclaimed(root, { project_map: { roots: ["src"] } }, []);
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.match(found[0].subject, /expense port/);
  });

  test("a commit an issue claims is not reported", () => {
    const { root, shas } = repository([["src/a.ts", "issue work"]]);
    sandbox = root;
    const records = [issue({ id: "i-1", pipeline_state: state({ last_commit_sha: shas[0] }) })];
    assert.deepEqual(unclaimed(root, { project_map: { roots: ["src"] } }, records), []);
  });

  test("the other commits of a claimed issue are claimed too", () => {
    // An issue records only its LAST commit, and routinely produces two: the
    // red tests, then the implementation. Reading the sha alone reported half
    // of every pipeline issue as unclaimed — the kind of noise that gets a
    // report switched off.
    const { root, shas } = repository([
      ["src/a.test.ts", "test(i-0002): epingler le contrat"],
      ["src/a.ts", "feat(i-0002): implementer le contrat"],
    ]);
    sandbox = root;
    const records = [issue({ id: "i-0002", pipeline_state: state({ last_commit_sha: shas[1] }) })];
    assert.deepEqual(unclaimed(root, { project_map: { roots: ["src"] } }, records), []);
  });

  test("Sudocode alphanumeric issue ids claim their earlier commits", () => {
    const { root, shas } = repository([
      ["src/a.test.ts", "test: cover catalogue search for i-6lso"],
      ["src/a.ts", "feat: implement catalogue search for i-6lso"],
    ]);
    sandbox = root;
    const records = [issue({ id: "i-6lso", pipeline_state: state({ last_commit_sha: shas[1] }) })];
    assert.deepEqual(unclaimed(root, { project_map: { roots: ["src"] } }, records), []);
  });

  test("an issue id is not confused with a longer id sharing its prefix", () => {
    const { root } = repository([["src/a.ts", "feat: implement i-6lso-extra"]]);
    sandbox = root;
    const records = [issue({ id: "i-6lso" })];
    assert.equal(unclaimed(root, { project_map: { roots: ["src"] } }, records).length, 1);
  });

  test("a commit naming an issue the store does not carry is still unclaimed", () => {
    const { root } = repository([["src/a.ts", "feat(i-0099): du travail invente"]]);
    sandbox = root;
    const records = [issue({ id: "i-0002" })];
    assert.equal(unclaimed(root, { project_map: { roots: ["src"] } }, records).length, 1);
  });

  test("a commit touching nothing of the source is not the pipeline's business", () => {
    const { root } = repository([["README.md", "document the thing"]]);
    sandbox = root;
    assert.deepEqual(unclaimed(root, { project_map: { roots: ["src"] } }, []), []);
  });

  test("a commit that declares itself direct is accounted for, not hidden", () => {
    // Direct work is legitimate — for a tooling fix, a question, an
    // exploration. What the framework refuses is direct work the operator
    // never heard about, so declaring it is the way through.
    const { root } = repository([["src/a.ts", "fix the build\n\ndirect: tooling fix, no contract change"]]);
    sandbox = root;
    assert.deepEqual(unclaimed(root, { project_map: { roots: ["src"] } }, []), []);
  });
});

describe("next-step says it rather than answering nothing to do", () => {
  test("an empty store with source commits is named as such", () => {
    const { root } = repository([["src/a.ts", "build the whole feature"]]);
    sandbox = root;
    writeStore(sandbox, "issues", []);
    const result = run(sandbox, "next-step.mjs", []);
    assert.match(result.output, /1/);
    assert.match(
      result.output,
      /never|jamais|store knows/i,
      "« no step to run » reads as nothing to do, which is the opposite of what is true",
    );
  });

  test("an empty store in a repository with no source commit stays quiet", () => {
    const { root } = repository([["README.md", "start"]]);
    sandbox = root;
    writeStore(sandbox, "issues", []);
    const result = run(sandbox, "next-step.mjs", []);
    assert.match(result.output, /no step to run/);
    assert.ok(!/never/i.test(result.output), "a fresh repository was accused of hiding work");
  });

  test("the report survives a directory that is not a repository at all", () => {
    sandbox = createSandbox();
    writeStore(sandbox, "issues", []);
    const result = run(sandbox, "next-step.mjs", []);
    assert.equal(result.status, 0, result.output);
  });
});
