# Quality gates

<!-- brief:implementer,qa,orchestrator -->
## Dead code

`dead_code` refuses an unused export, an orphan file, an unused dependency. **An export kept "for later" is dead code with an excuse**: nobody imports it, nothing proves it, and it will be maintained by someone who assumes it matters.

Two consequences to work with rather than against. A shared helper is created **at its first real use**, never in advance — creating it earlier makes it an export nobody imports, and the gate is right to refuse it. And a symbol whose only consumer is a test may be invisible to the tool if it treats specs as entry points: check what your tool actually counts before trusting a green result.
<!-- /brief -->

<!-- brief:implementer,qa,product -->
## Static security analysis

`sast` refuses `eval`, `new Function`, a dynamically built command, and the classic injection shapes. It reads patterns, not intentions: it will never see an authorisation check that was never written.

A rule disabled in the configuration is a **gate change**, therefore human review. Disabling one inline, in the file it concerns, is worse: it hides in a diff nobody reads twice. If a rule produces systematic false positives, disable it once, in the committed configuration, with the reason written next to it.
<!-- /brief -->

<!-- brief:implementer,qa -->
## Reuse before writing: the reuse note

**Every creation carries a note saying what was searched, what was found, and why it did not fit.** Not "I found nothing" — which describes a search nobody can check — but the closest existing component named, and the precise reason it does not answer.

The order of preference is fixed: **use as is**, then **extend with a parameter that has a backward-compatible default**, and only then **create a variant**. A variant created to avoid touching a shared component is the first step of divergence, and it is invisible until the two copies disagree.

The note is judged against the project map. That is why the map exists, and why a stale map is worse than no map.
<!-- /brief -->

<!-- brief:implementer,qa -->
## The project map, against which the note is judged

`project_map` regenerates a map of every public export, its nature and the first line of its contract, at the path declared in the configuration. `map_coverage` fails if a source file is missing from it.

**Profile contract.** The core cannot read your language: `commands.project_map` verifies the map, `project_map.regenerate` writes it, and `project_map.out` says where. A TypeScript profile can go through the compiler API, a Dart profile through `analyzer`, a Swift profile through `sourcekitten` — the roles only ever see a path and two commands, never the tool. The regeneration deliberately stays out of `commands`: every key there becomes a CI step, and a CI that rewrites the map before checking it would make the check pass whatever the code says.

**The map has one writer, and it is the Orchestrator.** It is a function of the whole source tree, so every issue adding an export changes it. Treated as an ordinary path it lands in every issue's reservations — and reservations are precisely what lets two issues run at once, so one generated file puts a whole wave in series. It measured as one of the two largest costs of a spec's wall time before it was named.

Hence the rule, enforced in four places rather than written in one: `next-issues` and `check-reservations` ignore generated paths when computing overlap, `validate-handoff` refuses a plan that reserves one, `verify-scope` refuses one in any diff but the Orchestrator's, and the Orchestrator runs `regenerate.mjs` once an issue closes — from a tree where nobody is mid-write, which is the whole reason the job is not the Implementer's.

**Its gate is a closure gate.** The map is stale on the branch from the first export added until the Orchestrator catches it up, so checking it on every push would mean a branch red by design — and a job red by design is a job people stop reading. The rendered workflow runs closure gates on `pull_request` only, and the `pre-push` hook leaves them alone. `closure_gates` in the configuration defers others the same way; the map is deferred whether or not it is listed, because that one is not a preference.

The trap is not a red gate, it is a green one: **a `--check` that compares an empty map to an empty map exits 0**. Count the files under your roots against the entries rendered, once, before trusting it.
<!-- /brief -->

<!-- brief:implementer,qa -->
## Comments: the contract survives, narration expires

`doc_lint` requires a contract on every exported symbol — description, one entry per parameter, a return when the function yields one. Renaming a parameter without its documentation fails.

`duplication` refuses a block repeated across the codebase. It is the reuse note made checkable: every prompt demands one for any creation, and until this gate existed that note was judged in review, which means it was judged when someone remembered to look. Read what it finds before touching its threshold — on this repository the first run surfaced an e2e bootstrap copied into three suites, while the project map already advertised the harnesses as reusable.

`comment_policy` refuses the opposite: describing what the code does, banners, section dividers, commented-out code, a `TODO` with no linked issue. **Narration describes today's implementation and lies tomorrow.** The why goes into the commit message; a trap already paid for goes into the profile's pitfalls document.

A non-exported function carries neither contract nor narration. If its body needs to be told, its name or its decomposition is what is wrong.
<!-- /brief -->

<!-- brief:product,qa -->
## What no tool proves

Gates catch what is missing far better than what is wrong. A missing contract fails; a wrong abstraction passes. A test that asserts nothing passes coverage; only a mutation gate sees it.

So there is a residue, and it is where review earns its place: whether the decomposition holds, whether an abstraction was worth its price, whether two decisions that are each defensible compose, whether a limit accepted deliberately is still acceptable.

**Quality is a command that fails or a proof that is demanded, never an adjective.** Where neither exists, say so instead of implying the gates covered it.
<!-- /brief -->
