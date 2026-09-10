# Demonstrating the pipeline to a client

A timed runbook for a live demonstration, about fifteen minutes, on a **prepared host**. The durations below were measured on a real installation on 2026-09-10; they are what a warm, prepared machine showed, not a promise for the client's.

The demonstration proves one sentence: a rule that cannot fail in a command is advice, and here every rule fails in a command. Everything you show follows from that.

## Before the session, on the host

Do all of this the day before, and verify it once end to end:

- the pipeline installed and all gates green on the host project (`preflight.mjs --timeout-seconds 60` confirms every declared command is executable, with durations);
- the tracker initialised with **one issue ready to work on** — small, real, and already refined by a Product run;
- the Docker images pulled, if the security controls are configured: the first ZAP pull takes minutes and must never happen in front of the client;
- the dashboard server reachable at `http://127.0.0.1:4399`;
- a terminal at the project root, a second one free, and the project map open in an editor.

## The live sequence

| Step | Command | Expected duration | What to say |
| --- | --- | --- | --- |
| 1. What runs next | `node agent-pipeline/scripts/next-step.mjs` | instant | The schedule is computed from dependencies and reservations, not chosen by an agent. |
| 2. Dispatch | `node agent-pipeline/scripts/dispatch.mjs <issue-id> implementer` | the role's own run time; heartbeat every 20 s | Output streams live; the heartbeat proves the run is alive; an interruption propagates to the child. |
| 3. The dashboard | open `http://127.0.0.1:4399` | instant | The dashboard reads the same scheduler state; it is a view, never a second source of truth. |
| 4. A gate that refuses | introduce one deliberate defect (a type error is enough), run the `check` gate, restore | about 30 s | This is the demonstration's centre: a green gate is only worth what its red costs. |
| 5. Security baseline | `node agent-pipeline/scripts/security-scan.mjs baseline` | about 16 s warm | The passive scan runs against the disposable environment only; the contract refuses anything else. |
| 6. Load | the configured `load` command | about 33 s warm | Thresholds are the project's decision; the gate only measures them. |
| 7. Evidence | `ls pipeline/evidence/` | instant | Every control leaves a durable record bound to a commit; QA reads it instead of re-running. |

Steps 5 and 6 apply only to a host whose security contract is configured; skip them otherwise rather than improvising a target.

## What never happens live

- **A full installation.** Hours of calibration and negative proofs are not a spectacle; describe them, show the checklist, do not run them.
- **The first ZAP image pull.** Pulled during preparation or not at all.
- **`dast_active` without written authorization.** The active scan attacks its target; it runs only against the declared disposable environment, under the reviewed contract. In front of a client, an unauthorized active scan is a security incident with witnesses.
- **An issue closed for the demo.** Closure gates and human-review receipts exist precisely so that a demonstration cannot shorten them.

## If the client's stack is unknown

Do not install on the client's stack live. Show the pipeline on the prepared repository first, then spend about ten minutes on their repository with no risk attached:

1. run `node agent-pipeline/scripts/init.mjs` and answer its questions — it records the product, the imposed stack and the architecture decision, and nothing else;
2. inspect the real manifests and sources of their stack, and compare with the [stack recipes](stack-recipes/index.md) to sketch the gate-to-tool mapping;
3. record the decisions: the recipes say which tool usually answers each gate, the installation guide says how each gate is then calibrated and negatively proven.

Ten minutes that end with decisions written down and a mapping sketched is a better close than a half-finished installation. The full profile, its tooling and its negative proofs are scheduled work, done with the procedure in [the installation guide](nouveau-profil.md) — not live.
