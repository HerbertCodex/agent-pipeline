import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createDashboard, readDataModelEvidence, readIssueCatalog } from "../dashboard/server.mjs";
import { readIssueTracker, trackerBinding } from "../scripts/issue-tracker.mjs";
import {
  createSandbox,
  enableIssueTracker,
  issue,
  trackerIssue,
  writeStore,
} from "./harness.mjs";
import { chdirToFramework } from "./framework-root.mjs";

chdirToFramework();

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
  child.stdin = new PassThrough();
  child.killedWith = null;
  child.kill = (signal) => {
    child.killedWith = signal;
    return true;
  };
  return child;
}

function selectableIssues() {
  return [
    {
      id: "i-001",
      title: "First issue",
      spec_id: "s-001",
      phase: "planned",
      owner: "orchestrator",
      priority: 1,
      depends_on: [],
      reservations: ["src/first.mjs"],
      criteria_count: 2,
      role: "implementer",
      dispatchable: true,
      reason: "Ready to start",
    },
    {
      id: "i-002",
      title: "QA issue",
      spec_id: "s-001",
      phase: "qa_in_progress",
      owner: "qa",
      priority: 2,
      depends_on: [],
      reservations: ["src/second.mjs"],
      criteria_count: 1,
      role: "qa",
      dispatchable: true,
      reason: "Resume the role that owns this phase",
    },
  ];
}

async function runningDashboard(
  launchProcess = () => fakeProcess(),
  issueSource = selectableIssues,
  interactiveInput = false,
) {
  const dashboard = createDashboard({ launchProcess, issueSource, interactiveInput });
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
    assert.match(page, /Search issues/);
    assert.match(page, /id="issues"/);
    assert.match(page, /Dependencies:/);
    assert.match(page, /Reservations:/);
    assert.match(page, /aria-live="polite"/);
    assert.match(page, /Security and load reports/);
    assert.match(page, /id="security-reports"/);
    assert.match(page, /Relational data governance/);
    assert.match(page, /id="data-model-reports"/);
    assert.match(page, /output\.textContent/);
    assert.doesNotMatch(page, /innerHTML/);
    assert.doesNotMatch(page, /<script[^>]+src=/);
    assert.doesNotMatch(page, /<link[^>]+href=/);
  });

  test("exposes durable security reports with scan coverage and timing", async () => {
    const dashboard = createDashboard({
      issueSource: selectableIssues,
      securitySource: () => [{
        kind: "zap",
        mode: "baseline",
        status: "passed",
        target: "http://app:3000",
        authenticated: true,
        commit_sha: "deadbeef",
        duration_ms: 1250,
        summary: { discovered_url_count: 18, affected_url_count: 2, alert_count: 2, risks: { High: 0, Medium: 2 } },
        reports: ["report.html", "report.sarif.json"],
      }],
    });
    dashboards.push(dashboard);
    await dashboard.listen(0, "127.0.0.1");
    const address = dashboard.address();
    const snapshot = await (await fetch(`http://127.0.0.1:${address.port}/api/snapshot`)).json();

    assert.equal(snapshot.security_reports.length, 1);
    assert.equal(snapshot.security_reports[0].authenticated, true);
    assert.equal(snapshot.security_reports[0].duration_ms, 1250);
    assert.equal(snapshot.security_reports[0].summary.discovered_url_count, 18);
  });

  test("exposes sanitized relational governance controls and limitations", async () => {
    const dashboard = createDashboard({
      issueSource: selectableIssues,
      dataModelSource: () => [{
        revision: "cafebabe",
        contract: "docs/data-model.contract.json",
        summary: { entities: 4 },
        controls: [
          { name: "normalization", status: "contract_verified", statement: "Declared dependencies checked." },
          { name: "data_authorization", status: "proof_required", statement: "Execute authorization gate." },
        ],
        proofs: { authorization: { gate: "test_data_authorization", replay: "per_issue" } },
      }],
    });
    dashboards.push(dashboard);
    await dashboard.listen(0, "127.0.0.1");
    const address = dashboard.address();
    const snapshot = await (await fetch(`http://127.0.0.1:${address.port}/api/snapshot`)).json();

    assert.equal(snapshot.data_model_reports[0].revision, "cafebabe");
    assert.equal(snapshot.data_model_reports[0].controls[1].status, "proof_required");
  });

  test("reads only fixed non-secret fields from relational governance evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-data-dashboard-"));
    sandboxes.push(root);
    mkdirSync(join(root, "evidence"), { recursive: true });
    writeFileSync(join(root, "evidence", "latest.json"), JSON.stringify({
      generated_at: "2026-09-08T00:00:00.000Z",
      revision: "abc",
      contract: "docs/model.json",
      secret: "must-not-leak",
      summary: { entities: 2, credential: "must-not-leak" },
      controls: [{ name: "database_security", status: "proof_required", statement: "Run the gate.", raw_credentials: "must-not-leak" }],
      proofs: { database_security: { gate: "db_security", replay: "per_issue", token: "must-not-leak" } },
    }));
    const reports = readDataModelEvidence(root, { data_model: { governance_version: 2, reports_dir: "evidence" } });
    assert.equal(reports[0].controls[0].name, "database_security");
    assert.doesNotMatch(JSON.stringify(reports), /must-not-leak/);
    assert.throws(() => readDataModelEvidence(root, { data_model: { governance_version: 2, reports_dir: "../outside" } }), /escapes the project/);
  });

  test("lists selectable issues from the durable store view", async () => {
    const { origin } = await runningDashboard();
    const response = await fetch(`${origin}/api/issues`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.issues.length, 2);
    assert.deepEqual(payload.issues[0], { ...selectableIssues()[0], active: false });
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
    child.stdout.write('{"type":"completed","run_id":"agent-run","role":"implementer","exit_code":0,"elapsed_ms":3200,"run_record":"pipeline/runs/agent-run.json"}\n');
    child.emit("close", 0);

    const snapshot = await (await fetch(`${origin}/api/snapshot`)).json();
    assert.equal(snapshot.runs.length, 1);
    assert.equal(snapshot.runs[0].id, accepted.run_id);
    assert.equal(snapshot.runs[0].runtime_run_id, "agent-run");
    assert.equal(snapshot.runs[0].run_record, "pipeline/runs/agent-run.json");
    assert.equal(snapshot.runs[0].issue_id, "i-001");
    assert.equal(snapshot.runs[0].status, "completed");
    assert.equal(snapshot.runs[0].elapsed_ms, 3200);
    assert.match(snapshot.runs[0].output, /red test pinned/);
  });

  test("measures silent execution and freezes duration when a child exits without events", async () => {
    const child = fakeProcess();
    const { dashboard, origin } = await runningDashboard(() => child);
    await post(origin, "/api/dispatch", dashboard.token, { issue_id: "i-001", role: "implementer" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const running = (await (await fetch(`${origin}/api/snapshot`)).json()).runs[0];
    assert.ok(running.duration_ms >= 20);
    assert.equal(running.finished_at, null);
    child.emit("close", 1);
    const finished = (await (await fetch(`${origin}/api/snapshot`)).json()).runs[0];
    assert.ok(finished.duration_ms >= running.duration_ms);
    assert.ok(finished.finished_at);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const later = (await (await fetch(`${origin}/api/snapshot`)).json()).runs[0];
    assert.equal(later.duration_ms, finished.duration_ms);
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

  test("forwards operator guidance only when the runtime declares interactive input", async () => {
    const child = fakeProcess();
    let input = "";
    child.stdin.on("data", (chunk) => { input += chunk.toString(); });
    const { dashboard, origin } = await runningDashboard(() => child, selectableIssues, true);
    const launched = await (
      await post(origin, "/api/dispatch", dashboard.token, {
        issue_id: "i-001",
        role: "implementer",
      })
    ).json();
    const response = await post(
      origin,
      `/api/runs/${launched.run_id}/input`,
      dashboard.token,
      { message: "Keep the existing API contract." },
    );

    assert.equal(response.status, 202);
    assert.equal(input, "Keep the existing API contract.\n");
    const snapshot = await (await fetch(`${origin}/api/snapshot`)).json();
    assert.equal(snapshot.runs[0].interactive, true);
    assert.match(snapshot.runs[0].output, /\[operator\]/);
  });

  test("refuses messages for a non-interactive runtime", async () => {
    const child = fakeProcess();
    const { dashboard, origin } = await runningDashboard(() => child);
    const launched = await (
      await post(origin, "/api/dispatch", dashboard.token, {
        issue_id: "i-001",
        role: "implementer",
      })
    ).json();
    const response = await post(
      origin,
      `/api/runs/${launched.run_id}/input`,
      dashboard.token,
      { message: "hello" },
    );
    assert.equal(response.status, 409);
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

  test("refuses unknown, blocked, mismatched and duplicate dispatches", async () => {
    const child = fakeProcess();
    const issueSource = () => [
      ...selectableIssues(),
      {
        ...selectableIssues()[0],
        id: "i-blocked",
        dispatchable: false,
        role: null,
        reason: "depends on i-001",
      },
    ];
    const { dashboard, origin } = await runningDashboard(() => child, issueSource);
    const unknown = await post(origin, "/api/dispatch", dashboard.token, {
      issue_id: "i-missing",
      role: "implementer",
    });
    const blocked = await post(origin, "/api/dispatch", dashboard.token, {
      issue_id: "i-blocked",
      role: "implementer",
    });
    const mismatch = await post(origin, "/api/dispatch", dashboard.token, {
      issue_id: "i-002",
      role: "implementer",
    });
    const accepted = await post(origin, "/api/dispatch", dashboard.token, {
      issue_id: "i-001",
      role: "implementer",
    });
    const duplicate = await post(origin, "/api/dispatch", dashboard.token, {
      issue_id: "i-001",
      role: "implementer",
    });

    assert.equal(unknown.status, 404);
    assert.equal(blocked.status, 409);
    assert.match((await blocked.json()).error, /depends on i-001/);
    assert.equal(mismatch.status, 409);
    assert.equal(accepted.status, 202);
    assert.equal(duplicate.status, 409);
    assert.match((await duplicate.json()).error, /already running/);
  });

  test("derives issue selection and role from project state", () => {
    const root = mkdtempSync(join(tmpdir(), "dashboard-catalog-"));
    sandboxes.push(root);
    mkdirSync(join(root, "store"));
    writeFileSync(
      join(root, "pipeline.config.json"),
      JSON.stringify({
        store_dir: "store",
        rules_path: "rules.json",
        file_policy: { implementer: { allow: ["src/**"] } },
      }),
    );
    writeFileSync(
      join(root, "rules.json"),
      JSON.stringify({
        phases: {
          planned: { owner: "orchestrator" },
          in_progress: { owner: "implementer" },
          ready_for_qa: { owner: "orchestrator" },
          qa_in_progress: { owner: "qa" },
          closed: { owner: "none" },
          operator_escalation: { owner: "operator" },
        },
        reservation_holding_phases: ["in_progress", "ready_for_qa", "qa_in_progress"],
      }),
    );
    const records = [
      {
        id: "i-ready",
        title: "Ready work",
        description: "Full issue description",
        spec_id: "s-one",
        priority: 1,
        acceptance_criteria: ["first", "second"],
        pipeline_state: { phase: "planned", file_reservations: ["src/ready.mjs"] },
      },
      {
        id: "i-waiting",
        title: "Waiting work",
        depends_on: ["i-active"],
        pipeline_state: { phase: "planned", file_reservations: ["src/waiting.mjs"] },
      },
      {
        id: "i-active",
        title: "Active work",
        pipeline_state: { phase: "in_progress", file_reservations: ["src/active.mjs"] },
      },
      {
        id: "i-review",
        title: "Review work",
        pipeline_state: { phase: "ready_for_qa", file_reservations: ["src/review.mjs"] },
      },
      {
        id: "i-done",
        title: "Done work",
        pipeline_state: { phase: "closed", file_reservations: ["src/done.mjs"] },
      },
    ];
    writeFileSync(
      join(root, "store", "issues.jsonl"),
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    );

    const issues = readIssueCatalog(root);
    const byId = new Map(issues.map((issue) => [issue.id, issue]));

    assert.equal(byId.get("i-ready").dispatchable, true);
    assert.equal(byId.get("i-ready").role, "implementer");
    assert.equal(byId.get("i-ready").criteria_count, 2);
    assert.equal(byId.get("i-ready").description, "Full issue description");
    assert.deepEqual(byId.get("i-ready").acceptance_criteria, ["first", "second"]);
    assert.equal(byId.get("i-waiting").dispatchable, false);
    assert.match(byId.get("i-waiting").reason, /depends on i-active/);
    assert.equal(byId.get("i-active").role, "implementer");
    assert.equal(byId.get("i-review").role, "qa");
    assert.equal(byId.get("i-done").dispatchable, false);
  });

  test("joins Sudocode issues with pipeline control and exposes unimported work", () => {
    const root = createSandbox();
    sandboxes.push(root);
    const source = trackerIssue({ title: "Authoritative title" });
    const unimported = trackerIssue({
      id: "i-new",
      uuid: "22222222-2222-4222-8222-222222222222",
      title: "New Sudocode issue",
    });
    const trackerConfig = enableIssueTracker(root, { issues: [source, unimported] });
    const config = JSON.parse(readFileSync(join(root, "pipeline.config.json"), "utf8"));
    const snapshot = readIssueTracker(config, root);
    writeStore(root, "issues", [issue({ tracker: trackerBinding(snapshot.issues[0]) })]);

    let catalog = new Map(readIssueCatalog(root).map((item) => [item.id, item]));
    assert.equal(catalog.get("i-t1").title, "Authoritative title");
    assert.equal(catalog.get("i-t1").description, source.content);
    assert.equal(catalog.get("i-new").description, unimported.content);
    assert.deepEqual(catalog.get("i-new").acceptance_criteria, []);
    assert.equal(catalog.get("i-t1").tracker_status, "open");
    assert.equal(catalog.get("i-t1").dispatchable, true);
    assert.equal(catalog.get("i-new").phase, "not_imported");
    assert.equal(catalog.get("i-new").dispatchable, false);
    assert.match(catalog.get("i-new").reason, /Import this Sudocode issue/);

    enableIssueTracker(root, {
      issues: [{ ...source, content: "Scope changed in Sudocode." }, unimported],
    });
    catalog = new Map(readIssueCatalog(root).map((item) => [item.id, item]));
    assert.equal(catalog.get("i-t1").dispatchable, false);
    assert.match(catalog.get("i-t1").reason, /scope/);
    assert.equal(trackerConfig.provider, "sudocode");
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
    const dashboard = createDashboard({
      cwd: project,
      frameworkRoot,
      issueSource: () => [
        {
          ...selectableIssues()[0],
          id: "i-adjacent",
        },
      ],
    });
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
