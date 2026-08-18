# State machine

<!-- brief:orchestrator,product,implementer,qa -->
## Phases and owners

| Phase | Owner | What is expected of them |
| --- | --- | --- |
| planned | orchestrator | dispatch the Implementer |
| in_progress | implementer | red tests proven, then the code that turns them green |
| ready_for_qa | orchestrator | handoff validated, red replayed, scope verified |
| qa_in_progress | qa | full battery plus qualitative review |
| closed | none | nothing |

Blocking phases: `blocked_product` (criteria missing or ambiguous), `blocked_dependency` (a package decision), `blocked_infrastructure` (a tool is unavailable), `operator_escalation`. **Every transition outside the list in `rules.json` is refused by `store-update`** — the script confronts the pair `(phase left, phase entered)` with `transitions` and fails without writing anything. This sentence was false until 2026-08-17: it described a check that did not exist, and only the discipline of the roles made it true.

Writing a `pipeline_state` whose phase is **unchanged** is an *amendment*, not a transition: the version advances by one, the `transitions` journal records nothing. That is the path for correcting reservations or a state field without manufacturing a movement that `metrics` would count.

## One role writes its tests and its code

The Implementer owns both. That is deliberate: the Test Writer / Coder boundary cost a full handoff, a cold start and two persisted transitions per issue, for a benefit that appeared once across six measured issues.

What the boundary used to guarantee is replaced by three things that do not depend on anyone's good faith:

- **`evidence.red_proof`** — the exact command, its non-zero exit code, and the test commit it was observed against;
- **the orchestrator replays it** against that commit, in a detached worktree. Red is observed, never declared;
- **two separate commits**, `test:` then `feat:`, which QA diffs.

A red proof that only fails at module load is weaker than one that fails on an assertion: it establishes that the tests came before the code, not that they would bite. Say which criteria are covered by which kind — QA replays the distinction.

## A code fault goes back to the Implementer

QA never fixes. A code fault returns to the Implementer, **who pins it with a red test before correcting it**: a fix with no test that failed first proves nothing about the next regression.

**Three code rejections on the same issue escalate to the operator**, never a fourth cycle. The counter lives in `pipeline_state.qa_code_rejections` and only counts `fault: code` — an infrastructure fault or a spec fault is somebody else's problem and does not consume the budget.

## Reservations

An issue holds its declared paths from the moment it leaves `planned` until it is `closed`, blocking phases included. An issue with no reservation is unguarded, therefore blocking: `check-reservations` refuses to dispatch anything alongside it.

Overlap is computed, conservative, never judged. Two issues whose reservations intersect are serialised even if a human would say they do not really conflict — the cost of a wrong serialisation is a wait, the cost of a wrong parallel run is a corrupted diff.
<!-- /brief -->

<!-- brief:orchestrator -->
## Resuming after an interruption

The store cannot distinguish a working role from a dead one: same record, same reading. **A held phase is redispatched, never waited on.**

Redispatching means handing back the previous document **in full, verbatim**. A cold agent given a summary of its own prior work will reconstruct the missing detail, and reconstruction is indistinguishable from fabrication until someone checks. This has already produced a handoff reporting eighteen commands that were never run.

`next-step.mjs` names the step from the store, never from a memory of what was done before. `--assert-advanced <issue> <version-before>` is the gate the driver runs afterwards: `pipeline_state.version` increments by exactly one per persistence, so any other gap is a step that overflowed.
<!-- /brief -->
