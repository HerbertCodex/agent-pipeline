# Security gates

<!-- brief:orchestrator,product,implementer,qa -->
## What a green gate does and does not say

Two commands guard the supply chain and the source: `audit` refuses a dependency carrying a vulnerability at or above the configured level, `secrets_scan` sweeps the tree for hard-coded credentials.
<!-- gate:sast -->
A third joins them where it is declared: `sast` looks for the classic dangerous constructs.
<!-- /gate -->

<!-- gate:security_scope -->
`security_scope` validates a project's dynamic-test boundary, OWASP Top 10 2025
assurance ledger, target allowlist and accepted-finding expiries without sending
traffic.
<!-- /gate -->
<!-- gate:dast_baseline -->
`dast_baseline` proves what ZAP could reach and passively inspect in the configured
test environment. Its report does not make claims about unreachable behavior.
<!-- /gate -->
<!-- gate:dast_active -->
`dast_active` attacks only the allowlisted target in disposable data, within the
declared scan and per-rule durations.
<!-- /gate -->
<!-- gate:dast_api -->
`dast_api` imports the declared OpenAPI, GraphQL or SOAP definition before its
bounded active scan.
<!-- /gate -->

Each has a limit worth knowing, because a gate believed wider than it is protects less than no gate at all:

- **`secrets_scan` sweeps the working tree, not the git history.** A secret already pushed is rotated, not scanned away. The gate will never catch it.
- **`audit` reports what its database knows today.** A green result is a statement about the present, and it is the reason the command runs on every push rather than once.
<!-- gate:sast -->
- **`sast` finds patterns, not intentions.** It does not know your domain, so it cannot see an authorisation check that was never written.
<!-- /gate -->
<!-- gate:dast_baseline -->
- **A dynamic scan sees reached traffic, not the whole product.** Authentication
  proof, explored URL count, exact target and revision belong with every result.
<!-- /gate -->
<!-- /brief -->

<!-- brief:qa,orchestrator -->
## Accepted findings are dated, or they are forgotten

A finding that is accepted rather than fixed goes into a baseline file at the repository root, with its date and its reason. Without that file, "we know about it" lives in a conversation and dies with it.

Two rules keep the baseline honest: an entry names the finding precisely enough that a reader can tell whether it is still the same one, and **an empty baseline is a statement too** — it says no finding is currently accepted, which is what makes a new finding visibly new.
<!-- /brief -->

<!-- brief:qa,product -->
## The surfaces that require a human

Some things no command measures. Name them in the pull request rather than hoping a reviewer notices:

- any route reachable without authentication, and what it publishes;
- personal data stored, and whether any response exposes it;
- an identifier that can be enumerated;
- a change to a gate itself — loosening one is a security decision;
- anything under the profile's human-review paths.

**Naming a surface is not asking permission; it is refusing to let it pass unseen.**
<!-- /brief -->

<!-- brief:product,implementer,qa -->
## Fail closed

A control that cannot decide refuses. A validator that cannot read its input refuses. A parser that meets something unexpected refuses.

The opposite — continuing with a permissive default — produces a system that works in testing and is open in production, and the difference is invisible until someone looks for it.
<!-- /brief -->
