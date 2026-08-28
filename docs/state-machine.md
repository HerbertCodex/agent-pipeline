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

A red proof that only fails at module load is weaker than one that fails on an assertion: it establishes that the tests came before the code, not that they would catch a mistake. Say which criteria are covered by which kind — QA replays the distinction.

## An escaped defect leaves a rule behind

`escaped_from` marks an issue that repairs a defect QA let through. Until 2026-08-19 the pipeline recorded that fact and did nothing with it: the fix shipped, the issue closed, and the next agent could reproduce the same mistake with nothing in the way. **Counting escapes is not learning from them.**

`store-verify` now refuses to close such an issue without a `prevention` block naming either `gate` — a command in the configuration that refuses the defect from now on — or `pitfall`, a line written into the profile's pitfalls document. Both are verified rather than believed: an unknown command key is refused, and so is a pitfall the document does not actually carry.

A free-text note is not accepted. "We will be careful" is what this framework exists to replace.

The two answers are not equivalent, and the order matters. A gate is worth more than a pitfall, because it does not depend on anyone reading it. The pitfall exists for what no command can express — a trap of judgement, a surprising interaction, a cost discovered too late.

**It still does not choose another approach when one fails**, and that remains deliberate: a pipeline that switched approach on its own would take a design decision without the person who owns the product. What it now does is report.

## An escalation reports, it does not merely stop

An escalation carries `attempts`, one entry per approach tried, each with `approach` and `failed_because`. The count is confronted with `qa_code_rejections`: a report shorter than the number of failures leaves some of them unaccounted for, and the ones left out are exactly what the operator would suggest first.

Until 2026-08-19 the escalation carried only the fact of failure. Three cycles were paid for and none of them reached the person who then had to decide. `render-decisions` now prints them under **Already tried**, on the page that page exists for.

**A defect found while writing this:** an escalation from QA was *unrepresentable*. `rules.json` declared the transition and the QA prompt prescribed it, but `validate-handoff` required a `fault` on every non-closing QA handoff, and every fault in the table routes somewhere that is not `operator_escalation`. Any escalation QA submitted was refused, whatever it carried. An escalation is now its own shape: no routed fault, and `attempts` instead.

## A code fault goes back to the Implementer

QA never fixes. A code fault returns to the Implementer, **who pins it with a red test before correcting it**: a fix with no test that failed first proves nothing about the next regression.

**Three code rejections on the same issue escalate to the operator**, never a fourth cycle. `store-update` enforces the counter against `transition_reason.fault`: a code fault increments exactly once, the third must target `operator_escalation`, and `test`, infrastructure, dependency or spec faults do not consume the budget.

## Reservations

An issue holds its declared paths from the moment it leaves `planned` until it is `closed`, blocking phases included. An issue with no reservation is unguarded, therefore blocking: `check-reservations` refuses to dispatch anything alongside it.

Overlap is computed, conservative, never judged. Two issues whose reservations intersect are serialised even if a human would say they do not really conflict — the cost of a wrong serialisation is a wait, the cost of a wrong parallel run is a corrupted diff.
<!-- /brief -->

<!-- brief:orchestrator -->
## Resuming after an interruption

The store cannot distinguish a working role from a dead one: same record, same reading. **A held phase is redispatched, never waited on.**

Redispatching means handing back the previous document **in full, verbatim**. A cold agent given a summary of its own prior work will reconstruct the missing detail, and reconstruction is indistinguishable from fabrication until someone checks. This has already produced a handoff reporting eighteen commands that were never run.

`next-step.mjs` names the issue from the store, never from a memory of what was done before. A run may persist up to `workflow.max_transitions_per_run` transitions on that issue (four by default, one nominal cycle), then stops. `--assert-advanced <issue> <version-before>` refuses zero progress and any larger gap. This keeps context bounded without paying one orchestrator cold start per transition.
<!-- /brief -->
