import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createSandbox, destroySandbox, writeStore, writeJson, run, issue, state, recordHash } from "./harness.mjs";
import { split } from "../scripts/timings.mjs";

let sandbox = null;
afterEach(() => {
  if (sandbox != null) destroySandbox(sandbox);
  sandbox = null;
});

/**
 * Builds a transition entry.
 *
 * @param from - phase left
 * @param to - phase entered
 * @param started - when the orchestrator dispatched the step
 * @param at - when it persisted the result
 * @returns the journal entry
 */
function step(from, to, started, at, ended = at) {
  return { from, to, started_at: started, ended_at: ended, at, version: 2 };
}

describe("a step is timed from dispatch to persistence, not from the previous one", () => {
  test("work is the step, waiting is what sits between two steps", () => {
    // The measurement that could not be made: fourteen hours between two
    // closures, no block, and no way to tell an agent working from nobody at
    // the keyboard. One timestamp separates them — when the orchestrator
    // dispatched, as opposed to when it persisted the answer.
    const record = {
      id: "i-1",
      transitions: [
        step("planned", "in_progress", "2026-08-20T08:00:00Z", "2026-08-20T09:00:00Z"),
        step("in_progress", "ready_for_qa", "2026-08-20T14:00:00Z", "2026-08-20T15:00:00Z"),
      ],
    };
    const measured = split([record]);
    assert.equal(measured.work, 2 * 3600, `travail : ${measured.work}s`);
    assert.equal(measured.waiting, 5 * 3600, `attente : ${measured.waiting}s`);
  });

  test("a transition with no dispatch time is counted as unknown, never as zero", () => {
    // Records written before the stamp existed carry none. Counting them as
    // instantaneous would report a pipeline faster than it ever was.
    const record = {
      id: "i-1",
      transitions: [
        { from: "planned", to: "in_progress", at: "2026-08-20T09:00:00Z", version: 2 },
        step("in_progress", "ready_for_qa", "2026-08-20T14:00:00Z", "2026-08-20T15:00:00Z"),
      ],
    };
    const measured = split([record]);
    assert.equal(measured.work, 3600);
    assert.equal(measured.unknown, 1);
  });

  test("time is attributed to the phase the step was leaving", () => {
    const record = {
      id: "i-1",
      transitions: [step("in_progress", "ready_for_qa", "2026-08-20T14:00:00Z", "2026-08-20T15:30:00Z")],
    };
    const measured = split([record]);
    assert.equal(measured.byPhase.in_progress.work, 5400);
  });

  test("elapsed is reported even when nothing can be split", () => {
    // A run recorded before the stamp is not a blank page: the wall clock
    // between two persisted steps was always there, and it is what showed
    // that implementation, not review, holds most of a spec's time.
    const record = {
      id: "i-1",
      transitions: [
        { from: "planned", to: "in_progress", at: "2026-08-20T08:00:00Z", version: 2 },
        { from: "in_progress", to: "ready_for_qa", at: "2026-08-20T20:00:00Z", version: 3 },
      ],
    };
    const measured = split([record]);
    assert.equal(measured.elapsed, 12 * 3600);
    assert.equal(measured.byPhase.in_progress.elapsed, 12 * 3600);
    assert.equal(measured.work, 0);
    assert.equal(measured.unknown, 2, "elapsed must not pass for a measurement of the work");
  });

  test("a step persisted before it was dispatched is refused, not averaged in", () => {
    const record = {
      id: "i-1",
      transitions: [step("planned", "in_progress", "2026-08-20T10:00:00Z", "2026-08-20T09:00:00Z")],
    };
    assert.throws(() => split([record]), /i-1/);
  });
});

describe("the orchestrator stamps when it dispatched", () => {
  test("store-update refuses a transition that does not say when the step began", () => {
    sandbox = createSandbox();
    writeStore(sandbox, "issues", [issue({ id: "i-t1" })]);
    const request = writeJson(sandbox, "r.json", {
      target: { kind: "issue", id: "i-t1" },
      expected_record_hash: recordHash(sandbox, "issues", "i-t1"),
      pipeline_state: state({ phase: "in_progress", owner: "implementer", version: 2 }),
    });
    const result = run(sandbox, "store-update.mjs", [request]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /started_at/);
    assert.match(result.output, /dispatch|began|waiting/i);
  });

  test("it refuses a dispatch time later than the persistence", () => {
    sandbox = createSandbox();
    writeStore(sandbox, "issues", [issue({ id: "i-t1" })]);
    const request = writeJson(sandbox, "r.json", {
      target: { kind: "issue", id: "i-t1" },
      expected_record_hash: recordHash(sandbox, "issues", "i-t1"),
      started_at: "2030-01-01T00:00:00.000Z",
      pipeline_state: state({
        phase: "in_progress",
        owner: "implementer",
        version: 2,
        last_transition_at: "2026-08-20T09:00:00.000Z",
      }),
    });
    const result = run(sandbox, "store-update.mjs", [request]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /started_at/);
  });

  test("store-update refuses a transition that does not say when the agent handed back", () => {
    sandbox = createSandbox();
    writeStore(sandbox, "issues", [issue({ id: "i-t1" })]);
    const request = writeJson(sandbox, "r.json", {
      target: { kind: "issue", id: "i-t1" },
      expected_record_hash: recordHash(sandbox, "issues", "i-t1"),
      started_at: "2026-08-20T08:00:00.000Z",
      pipeline_state: state({
        phase: "in_progress",
        owner: "implementer",
        version: 2,
        last_transition_at: "2026-08-20T09:00:00.000Z",
      }),
    });
    const result = run(sandbox, "store-update.mjs", [request]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /ended_at/);
    assert.match(result.output, /handed back|validation|agent/i);
  });

  test("it refuses a hand-back the step does not contain", () => {
    sandbox = createSandbox();
    writeStore(sandbox, "issues", [issue({ id: "i-t1" })]);
    const request = writeJson(sandbox, "r.json", {
      target: { kind: "issue", id: "i-t1" },
      expected_record_hash: recordHash(sandbox, "issues", "i-t1"),
      started_at: "2026-08-20T08:00:00.000Z",
      ended_at: "2026-08-20T12:00:00.000Z",
      pipeline_state: state({
        phase: "in_progress",
        owner: "implementer",
        version: 2,
        last_transition_at: "2026-08-20T09:00:00.000Z",
      }),
    });
    const result = run(sandbox, "store-update.mjs", [request]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /ended_at/);
  });

  test("an amendment carries no step, so it owes no dispatch time", () => {
    // The phase does not move: no step happened, and inventing one would skew
    // exactly the measurement this exists to make.
    sandbox = createSandbox();
    writeStore(sandbox, "issues", [issue({ id: "i-t1" })]);
    const request = writeJson(sandbox, "r.json", {
      target: { kind: "issue", id: "i-t1" },
      expected_record_hash: recordHash(sandbox, "issues", "i-t1"),
      pipeline_state: state({ phase: "planned", owner: "orchestrator", version: 2 }),
    });
    const result = run(sandbox, "store-update.mjs", [request]);
    assert.equal(result.status, 0, result.output);
  });
});

describe("a step says when the agent handed back, not only when it was persisted", () => {
  test("the agent's turnaround and the validation are counted apart", () => {
    // `at` marks the end of the step as persisted, and that conflates two
    // things: the agent returning its handoff, and the orchestrator
    // validating it — scope confronted with the diff, red proof replayed,
    // store invariants read. Twelve of the twenty measured hours sat in
    // `in_progress`, and nothing said which half they were.
    const record = {
      id: "i-1",
      transitions: [
        step("planned", "in_progress", "2026-08-20T08:00:00Z", "2026-08-20T11:00:00Z", "2026-08-20T10:30:00Z"),
      ],
    };
    const measured = split([record]);
    assert.equal(measured.agent, 2.5 * 3600, `agent : ${measured.agent}s`);
    assert.equal(measured.validation, 0.5 * 3600, `validation : ${measured.validation}s`);
    assert.equal(measured.work, 3 * 3600, "the two together are still the step");
  });

  test("a step with no hand-back time keeps its total and says the split is unknown", () => {
    const record = {
      id: "i-1",
      transitions: [
        { from: "planned", to: "in_progress", started_at: "2026-08-20T08:00:00Z", at: "2026-08-20T11:00:00Z", version: 2 },
      ],
    };
    const measured = split([record]);
    assert.equal(measured.work, 3 * 3600, "the step was measured; only its split is missing");
    assert.equal(measured.agent, 0);
    assert.equal(measured.unsplit, 1);
  });

  test("a hand-back after the persistence is refused", () => {
    const record = {
      id: "i-1",
      transitions: [
        step("planned", "in_progress", "2026-08-20T08:00:00Z", "2026-08-20T09:00:00Z", "2026-08-20T10:00:00Z"),
      ],
    };
    assert.throws(() => split([record]), /ended_at|i-1/);
  });
});
