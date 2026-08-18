# Testing policy

<!-- brief:implementer,qa -->
## What is NEVER tested

Styles, classes, colours, layout; static markup — labels, placeholders, containers; framework behaviour; third-party libraries (we test **our** use of them); trivial getters and re-exports; whole-object snapshots.

Presentation, responsiveness and accessibility are validated by QA in the real application according to the profile, never asserted in tests. The Implementer still has to implement them: **"no test covers it" is not a defence.**
<!-- /brief -->

<!-- brief:implementer,qa -->
## Mocks

Mock what you do not own and cannot run: a paid third party, a slow network, a clock. Do not mock what you own — mocking your own service asserts the shape of your mock, not the behaviour of your code.

A test that only checks a mock was called proves the call, not the outcome. Assert on the effect: the row written, the response returned, the state changed.
<!-- /brief -->

<!-- brief:qa,product,implementer -->
## Selection and budget

Every criterion carries the **lowest level that proves it**: `[unit]`, `[component]`, `[integration]`, `[e2e]`. A business rule proven end to end is a rule that will be slow to test and vague to diagnose; a wiring proven in a unit test is a wiring nobody verified.

The rule of thumb that survives: **prove the rule where it lives, prove the wiring where it is wired.** An end-to-end suite exists to show that the pieces are connected, not to enumerate business cases.
<!-- /brief -->

<!-- brief:orchestrator -->
## Fixtures

A test writes nothing into the repository tree. Temporary directories are created under the system temp path and removed afterwards — a data file left behind dirties the tree and breaks `verify-scope`, which then reports a file nobody declared.

Two runs of the same suite give the same result. A suite that depends on execution order, on a shared clock, or on a file left by the previous run is a suite that will fail on someone else's machine and be declared flaky rather than fixed.
<!-- /brief -->

<!-- brief:implementer,qa -->
## Coverage: a signal, never a target

Coverage measures what is **executed**, not what is **asserted**. A test that calls a function and checks nothing counts as covered.

The threshold exists to catch a collapse, not to certify quality. Writing a test to move the number is the failure mode the metric invites, and it is worse than the gap it fills — it adds maintenance and proves nothing.

Where the profile runs a mutation gate, that is the one that says whether the tests would actually catch a change in the code. Where it does not, say so instead of letting a coverage figure imply it.

## Red proof

The red is **observed**, never declared: the exact command, its non-zero exit code, the test commit it was seen against. The orchestrator replays it against that commit.

Two kinds of red are not worth the same. A red that fails at module load, because the code does not exist yet, establishes that the tests came first. A red that fails on an **assertion** establishes in addition that the assertion has content. **Say which criteria are covered by which** — the distinction is what a complacent test hides behind.

## Security tests

A security test belongs where hostile input reaches something that interprets it: a raw query, a command, a path, a template. Write it there.

Where the input never reaches an interpreter — bound parameters, an escaped value — the test asserts a property of the library, not of your code, and the testing policy refuses it. Prove the boundary instead: the value comes back byte for byte, the error message names no schema.
<!-- /brief -->
