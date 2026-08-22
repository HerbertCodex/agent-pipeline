# Entry point

{{project_summary}}

## The first question, before anything else

{{mode}}

A session does not launch sub-agents without an explicit request: that is a platform rule, above this file, so the pipeline never starts on its own. The consequence has been observed twice: a fresh session works straight through, does good work, and none of it reaches the pipeline. The second time, the store held zero lines while a whole feature sat in git.

`next-step` now says so instead of answering « no step to run », and `unclaimed.mjs` lists the commits no issue claims. **If either reports something, this project has already been worked directly** — say so before adding to it.

What direct loses is written below. Working directly is legitimate; doing it without the operator knowing is not.

## Read before acting

| When | What |
| --- | --- |
| Always, first | `AGENTS.md` — roles, sources of truth, prohibitions |
| Before creating anything at all | the project map — **generated**, lists every existing export with its role |
| Before touching a past decision | `{{decisions_dir}}` — dependencies, trade-offs, accepted risks |
| For the detail of a rule | `agent-pipeline/docs/` |

The project map is the answer to "does this already exist?". Reading it before creating a module, a service, a helper or a test harness is not optional: the reuse note demanded of every addition is judged against it.

## How the work happens

The operator states a need in plain language. The pipeline handles it:

**Product** writes the spec and cuts it into issues → **Implementer** pins the acceptance criteria as red tests, proves the red, then implements → **QA** verifies in the environment and writes the ledger → **Orchestrator** validates, persists, schedules.

The human operator keeps three things: installing a dependency, editing `pipeline.config.json`, and merging.

## What direct loses

Name it without softening it, when you ask:

- **no trace in the store** — `next-step`, `metrics` and the status page do not know the work exists; it lives in git, not in the pipeline;
- **no Product decomposition** — the session decides the contract alone then writes the tests that validate it, so its implementation is judged against itself;
- **no independent QA** — the automatic gates stay green, but the conditional review the stack documents describe (hostile input, headers compared and not only bodies, idempotence replayed against the real application) happens for nobody;
- **no `verify-scope`, no optimistic lock, no verification ledger.**

Working directly is legitimate — for a tooling fix, a question, an exploration. What is not legitimate is doing it **without the operator knowing**. A commit made that way carries a `direct:` line saying why, which is what keeps it out of the unclaimed list and puts the reason where a reviewer reads it.

## Commands

{{project_commands}}

The quality gates live in `pipeline.config.json` under `commands`. Any rule naming a command by its key designates that one.

## What is true of this repository and gets forgotten

{{project_context}}

## The rule that cost the most to relearn

**If no command can refuse it, a rule never applies.** A prompt that asks to read a file "if it exists", a documented mechanism no script checks: nobody fails, nobody reports, and the rule simply does not happen. If a rule matters, it has a gate or a validator behind it.
