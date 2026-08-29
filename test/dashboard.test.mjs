import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createDashboard } from "../dashboard/server.mjs";

const dashboards = [];
const sandboxes = [];

afterEach(async () => {
  await Promise.all(dashboards.splice(0).map((dashboard) => dashboard.close()));
  for (const sandbox of sandboxes.splice(0)) rmSync(sandbox, { recursive: true, force: true });
});

function fakeProcess() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killedWith = null;
  child.kill = (signal) => {
    child.killedWith = signal;
    return true;
  };
  return child;
}

async function runningDashboard(launchProcess = () => fakeProcess()) {
  const dashboard = createDashboard({ launchProcess });
  dashboards.push(dashboard);
  await dashboard.listen(0, "127.0.0.1");
  const address = dashboard.address();
  assert.ok(address != null && typeof address === "object");
  return { dashboard, origin: `http://127.0.0.1:${address.port}` };
}

async function post(origin, path, token, body = {}) {
  return fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-dashboard-token": token,
    },
    body: JSON.stringify(body),
  });
}

async function completedSnapshot(origin) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const snapshot = await (await fetch(`${origin}/api/snapshot`)).json();
    if (snapshot.runs[0]?.status === "completed") return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("the adjacent project run did not complete");
}

describe("live dashboard: a local view over portable agent events", () => {
  test("serves one self-contained and accessible page", async () => {
    const { origin } = await runningDashboard();
    const response = await fetch(origin);
    const page = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.match(page, /Agent pipeline/);
    assert.match(page, /aria-live="polite"/);
    assert.match(page, /output\.textContent/);
    assert.doesNotMatch(page, /innerHTML/);
    assert.doesNotMatch(page, /<script[^>]+src=/);
    assert.doesNotMatch(page, /<link[^>]+href=/);
  });

  test("refuses to expose agent output beyond the local machine", async () => {
    const dashboard = createDashboard();
    dashboards.push(dashboard);

    await assert.rejects(
      dashboard.listen(0, "0.0.0.0"),
      /only binds to a loopback address/,
    );
  });

  test("requires an explicit override before a container can bind all interfaces", async () => {
    const dashboard = createDashboard();
    dashboards.push(dashboard);

    await dashboard.listen(0, "0.0.0.0", { allowNonLoopback: true });
    const address = dashboard.address();

    assert.ok(address != null && typeof address === "object");
  });

  test("refuses a dispatch that did not come from its own page", async () => {
    const { origin } = await runningDashboard();
    const response = await post(origin, "/api/dispatch", "wrong-token", {
      issue_id: "i-001",
      role: "implementer",
    });

    assert.equal(response.status, 403);
  });

  test("turns NDJSON lifecycle output into a live run snapshot", async () => {
    const child = fakeProcess();
    const { dashboard, origin } = await runningDashboard(() => child);
    const response = await post(origin, "/api/dispatch", dashboard.token, {
      issue_id: "i-001",
      role: "implementer",
    });
    const accepted = await response.json();

    assert.equal(response.status, 202);
    child.stdout.write('{"type":"started","run_id":"agent-run","role":"implementer"}\n');
    child.stdout.write('{"type":"heartbeat","run_id":"agent-run","role":"implementer","elapsed_ms":2500}\n');
    child.stdout.write('{"type":"output","run_id":"agent-run","role":"implementer","stream":"stdout","text":"red test pinned\\n"}\n');
    child.stdout.write('{"type":"completed","run_id":"agent-run","role":"implementer","exit_code":0,"elapsed_ms":3200}\n');
    child.emit("close", 0);

    const snapshot = await (await fetch(`${origin}/api/snapshot`)).json();
    assert.equal(snapshot.runs.length, 1);
    assert.equal(snapshot.runs[0].id, accepted.run_id);
    assert.equal(snapshot.runs[0].issue_id, "i-001");
    assert.equal(snapshot.runs[0].status, "completed");
    assert.equal(snapshot.runs[0].elapsed_ms, 3200);
    assert.match(snapshot.runs[0].output, /red test pinned/);
  });

  test("interrupts the exact child attached to a run", async () => {
    const child = fakeProcess();
    const { dashboard, origin } = await runningDashboard(() => child);
    const launched = await (
      await post(origin, "/api/dispatch", dashboard.token, {
        issue_id: "i-002",
        role: "qa",
      })
    ).json();

    const response = await post(
      origin,
      `/api/runs/${launched.run_id}/interrupt`,
      dashboard.token,
    );

    assert.equal(response.status, 202);
    assert.equal(child.killedWith, "SIGTERM");
  });

  test("refuses malformed issue identifiers and unknown roles", async () => {
    const { dashboard, origin } = await runningDashboard();
    const unsafe = await post(origin, "/api/dispatch", dashboard.token, {
      issue_id: "../outside",
      role: "implementer",
    });
    const unknown = await post(origin, "/api/dispatch", dashboard.token, {
      issue_id: "i-001",
      role: "designer",
    });

    assert.equal(unsafe.status, 400);
    assert.equal(unknown.status, 400);
  });

  test("runs the framework from a sibling directory against the host project", async () => {
    const root = mkdtempSync(join(tmpdir(), "dashboard-adjacent-"));
    sandboxes.push(root);
    const frameworkRoot = join(root, "agent-pipeline");
    const project = join(root, "host-project");
    mkdirSync(join(frameworkRoot, "scripts"), { recursive: true });
    mkdirSync(project);
    writeFileSync(
      join(frameworkRoot, "scripts", "dispatch.mjs"),
      [
        'console.log(JSON.stringify({ type: "started", role: process.argv[3] }));',
        'console.log(JSON.stringify({ type: "output", text: process.cwd() }));',
        'console.log(JSON.stringify({ type: "completed", exit_code: 0 }));',
      ].join("\n"),
    );
    const dashboard = createDashboard({ cwd: project, frameworkRoot });
    dashboards.push(dashboard);
    await dashboard.listen(0, "127.0.0.1");
    const address = dashboard.address();
    assert.ok(address != null && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;

    const response = await post(origin, "/api/dispatch", dashboard.token, {
      issue_id: "i-adjacent",
      role: "implementer",
    });
    const snapshot = await completedSnapshot(origin);

    assert.equal(response.status, 202);
    assert.match(snapshot.runs[0].output, new RegExp(project.replaceAll("/", "\\/")));
  });
});
