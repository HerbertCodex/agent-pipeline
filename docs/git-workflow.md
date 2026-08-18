# Git workflow

<!-- brief:product,orchestrator -->
## One branch per spec

Product creates the spec branch from the default branch, on a clean tree. If the tree is dirty it returns a blocker instead of cleaning up after another agent — a working tree it did not write is not its to tidy.

The branch is not pushed while it is identical to its base: a CI run on a commit that changes nothing proves nothing and teaches everyone to skim the runs.
<!-- /brief -->

<!-- brief:implementer,product -->
## Two commits per issue

`test:` carries the tests alone and **replays red**. `feat:` carries the implementation. QA diffs the two, which is what makes the red proof checkable after the fact rather than merely reported.

Nothing else belongs in either commit. A generated target regenerated in the same commit is expected; a drive-by fix is not, and it will show up in `verify-scope` as a file nobody declared.
<!-- /brief -->

<!-- brief:implementer,orchestrator -->
## The commit message carries the why

The code says what it does. The message says why it was done that way, and above all which alternative was rejected and on what evidence.

A decision that is not obvious from the diff — a deviation from the prescribed architecture, an option whose default would have broken a criterion, a limit accepted deliberately — belongs there. `git blame` must be able to reach it.
<!-- /brief -->

<!-- brief:implementer,product,qa -->
## Never rewrite what has been pushed

No force-push on a shared branch, no rebase of commits another role has already read, no `--no-verify`. A hook that blocks is a gate speaking; going around it removes the gate for everyone, silently.

If a hook makes a legitimate step impossible, that is a finding to report, not an obstacle to bypass.
<!-- /brief -->

<!-- brief:product -->
## The pull request

One pull request per spec, opened after QA closes the last issue. It cites the CI run for the exact head SHA, says what changed and how to test it, and **names the surfaces that require human review** rather than leaving a reviewer to find them.
<!-- /brief -->
