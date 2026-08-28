# Quality gates

<!-- brief:implementer,qa,orchestrator -->
<!-- gate:dead_code -->
## Dead code

The framework ships `dead-code.mjs`, `doc-lint.mjs` and `sast.mjs`, declared by the configuration template so a new project has all three from the first day, without installing anything. They read shapes, not syntax: they refuse loudly on a tree they recognise nothing in rather than passing green, and each prints what it cannot see. Point the key at a real tool for your language whenever you have one — `knip`, a documentation linter, a static analyser — and the rest of the framework does not notice the swap.

`dead_code` refuses an unused export, an orphan file, an unused dependency. **An export kept "for later" is dead code with an excuse**: nobody imports it, nothing proves it, and it will be maintained by someone who assumes it matters.

Two consequences to work with rather than against. A shared helper is created **at its first real use**, never in advance — creating it earlier makes it an export nobody imports, and the gate is right to refuse it. And a symbol whose only consumer is a test may be invisible to the tool if it treats specs as entry points: check what your tool actually counts before trusting a green result.
<!-- /gate -->
<!-- /brief -->

<!-- brief:implementer,qa,product -->
<!-- gate:sast -->
## Static security analysis

`sast` refuses `eval`, `new Function`, a dynamically built command, and the classic injection shapes. It reads patterns, not intentions: it will never see an authorisation check that was never written.

A rule disabled in the configuration is a **gate change**, therefore human review. Disabling one inline, in the file it concerns, is worse: it hides in a diff nobody reads twice. If a rule produces systematic false positives, disable it once, in the committed configuration, with the reason written next to it.
<!-- /gate -->
<!-- /brief -->

<!-- brief:product,implementer,qa,orchestrator -->
## The mockup comes before the screen, and the check says so

The design-system page states the order: tokens, then primitives, then a finished mockup assembled from the primitives that exist, then screens. Two real runs went straight to the screens, and the check could not tell.

The first declared `mockup.not_applicable` — « this issue touches no screen » — on a diff carrying `.svelte` files. The exemption is a claim about the diff, and the diff can be read: an issue shipping a screen no longer exempts itself.

The second pointed `mockup.path` at the component it had just written. The check passed, because a component does reference the tokens — and it became **circular, the code verified against itself**.

What refuses it is the form: a mockup is a self-contained HTML page, opened rather than compiled, and handed over like every other page. That is not a taste — the check reads token references out of the file, so a form carrying none cannot be checked at all.

A second rule refused any mockup the diff carried, on the same grounds. Reading a real run killed it: **the issue whose whole job is to draw the mockup necessarily carries it**, alongside a route to display it, and the rule refused exactly the behaviour the framework asks for. What it was really catching was a source file used as a mockup, which the form check catches without the false positive.

And the demand moved earlier. Asking the implementer is asking at the last possible moment, where the only affordable answer is the escape. A plan whose issues reserve screen files names its mockup, so the operator sees it before the screens exist — which is the whole point of the order.

**And the mockup belongs to the spec.** Asking every handoff for one invites a drawing per issue, and issues are cut by component: five drawings that never compose are not a design. The plan names the spec's mockups — one `path`, or `paths` for a spec with several screens — the orchestrator persists them on the spec record, and an implementer handoff may only point at a path that list carries. A real run already behaved this way on its own, two issues referring to the same screen; nothing made it the only shape available, so it held by the agent's discipline rather than by a rule. A spec planned before this declares nothing and is not held to a list it never made.

What no command can check: whether the design-system and token pages were ever read. `apply-profile` verifies the block is declared, not that anyone looked at the page that helps decide it. That limit is stated rather than papered over with a ritual.
<!-- /brief -->

<!-- brief:implementer,qa,product,orchestrator -->
## One gate starts the application, because no static one does

Thirteen gates green on a real spec while every form answered 403: an origin was never configured, no criterion foresaw it, and it was found by starting the server by hand. Nothing in a static battery starts anything.

`smoke` is that gate. The framework does not know your tool — it requires the key, and what counts is a command that **starts the built artefact and exercises one real path end to end**: a request that goes through, a form that posts, a command that runs. Another unit test does not count: the failure this catches is every other gate passing while the product refuses everything.

## What no test reaches is declared

Every handoff carrying a commit names its `untested_surface`, and saying there is none is an answer that still has to be said. Two issues of one real spec closed with the same hole — no automated test reached the route actions — and nothing accumulated it, so nobody could see it was the same hole twice.

The store keeps it and the closure report gathers it. A hole named twice is a hole worth a spec of its own.
<!-- /brief -->

<!-- brief:implementer,qa,orchestrator -->
## A replay is a measurement, so its exit code must belong to it

`;` and `||` hand the shell's status to the LAST command. A replay written `run the tests ; restore the file` therefore reports the restore, and a verdict reading « replayed, exit 0 » for a claim asserting a failure contradicts itself. It happened twice on one run, and the agent caught it only on re-reading.

`validate-handoff` refuses a `how_to_replay` or a `red_proof.cmd` carrying either separator, outside quotes. `&&` is accepted: the first command to fail ends the chain and its status is the one returned, so nothing is hidden. Put the restore first, or replay in a detached worktree — which is what a real QA did once it noticed.

**And the implementer cites the battery, not a sample of it.** The same run had a handover citing two gates out of eight; QA replayed the rest, one refused a function over the length limit, and the issue came back. A whole cycle for something the handover could have been refused for. Both roles now cite every per-issue gate with its exit code.
<!-- /brief -->

<!-- brief:orchestrator -->
## Where the time went, and how the journal knows

A step is stamped three times. `started_at` is when the orchestrator dispatched it, `ended_at` when the agent handed its work back, `at` when the orchestrator finished validating and persisted. So the step itself splits in two — the agent's turnaround, then the validation that confronts the scope with the diff, replays the red proof and reads the invariants. What lies between one `at` and the next `started_at` is time the issue spent on nobody's desk.

Both stamps belong to the orchestrator, the one role that writes the store. Nothing trusts an agent's account of its own duration, which it has no clock to give.

`store-update` refuses a transition missing either stamp, and refuses a hand-back the step does not contain. A step measured without its hand-back keeps its total and says its split is unknown: reporting the whole of it as the agent's would charge the agent for the orchestrator's own work. `timings.mjs` reads the split, per phase and per spec.

Before the stamp existed, the journal could say twenty hours elapsed across a spec and could not say what part of it was work. That is what made every judgement about the pipeline's speed a guess — including the wrong one, that review dominated. It does not: on that spec, implementation held **12 h 17** of the wall clock and review **6 h 32**.

An amendment carries no step: the phase does not move, so no dispatch time is owed, and inventing one would skew exactly the measurement this exists to make.
<!-- /brief -->

<!-- brief:qa,orchestrator,product -->
## What an issue costs is proportionate to what it touches

Measured on a real run: an issue adding CSS variables to a stylesheet paid **eight criteria, six replayed claims and 3 514 characters of evidence** — the same as the issue that wired four interactive components. That is not rigour, it is an absence of proportion, and it is what makes a pipeline unusable where work has to ship.

Two things now scale with the issue rather than with nothing.

**The per-issue battery is computed, not recited.** It begins with every declared gate minus `closure_gates` and the map gates. `workflow.gates` may select a smaller declared subset for low and normal risk; high risk defaults to all. QA cites the battery selected from the issue's observed files as `{ key, cmd, exit }`. Anything omitted from the normal lane joins the final closure battery, so reducing feedback latency does not delete proof.

CI is deliberately not on that diet: a machine re-running `audit` on every push costs nothing and reports early, while an agent replaying it per issue costs the run. Only the map gates are deferred there.

**The risk lane follows the files.** `risk.high` and `risk.low` name path patterns; everything else is normal. A low-lane closure owes the gates and the ledger, and no replayed claims — proving a stylesheet twice proves nothing. A high lane owes everything.

The lane is **computed, never declared**. A lane an agent chooses is a lane every agent chooses, and the cheap one would empty itself of meaning within a day. It follows the files actually touched, `verify-scope` confronts those with the real diff, and the highest lane wins: an issue mixing a stylesheet and an authentication path is an authentication issue.
<!-- /brief -->

<!-- brief:implementer,qa -->
## Reuse before writing: the reuse note

**Every creation carries a note saying what was searched, what was found, and why it did not fit.** Not "I found nothing" — which describes a search nobody can check — but the closest existing component named, and the precise reason it does not answer.

The order of preference is fixed: **use as is**, then **extend with a parameter that has a backward-compatible default**, and only then **create a variant**. A variant created to avoid touching a shared component is the first step of divergence, and it is invisible until the two copies disagree.

The note is judged against the project map. That is why the map exists, and why a stale map is worse than no map.
<!-- /brief -->

<!-- brief:implementer,qa -->
## The project map, against which the note is judged

`project_map` regenerates a map of every public export, its nature and the first line of its contract, at the path declared in the configuration. <!-- gate:map_coverage -->`map_coverage` fails if a source file is missing from it.<!-- /gate -->

**Profile contract.** The core cannot read your language: `commands.project_map` verifies the map, `project_map.regenerate` writes it, and `project_map.out` says where. A TypeScript profile can go through the compiler API, a Dart profile through `analyzer`, a Swift profile through `sourcekitten` — the roles only ever see a path and two commands, never the tool. The regeneration deliberately stays out of `commands`: every key there becomes a CI step, and a CI that rewrites the map before checking it would make the check pass whatever the code says.

**The map has one writer, and it is the Orchestrator.** It is a function of the whole source tree, so every issue adding an export changes it. Treated as an ordinary path it lands in every issue's reservations — and reservations are precisely what lets two issues run at once, so one generated file puts a whole wave in series. It measured as one of the two largest costs of a spec's wall time before it was named.

Hence the rule, enforced in four places rather than written in one: `next-issues` and `check-reservations` ignore generated paths when computing overlap, `validate-handoff` refuses a plan that reserves one, `verify-scope` refuses one in any diff but the Orchestrator's, and the Orchestrator runs `regenerate.mjs` once an issue closes — from a tree where nobody is mid-write, which is the whole reason the job is not the Implementer's.

**Its gate is deferred, and it is the only kind that is.** The map is stale on the branch from the first export added until the Orchestrator catches it up, so checking it on every push would mean a branch red by design — and a job red by design is a job people stop reading. The rendered workflow runs the map's gates on `pull_request` only, and the `pre-push` hook leaves them alone. It is not a preference: `project_map` is deferred whether or not anything lists it.
<!-- gate:map_coverage -->
`map_coverage` is deferred with it, because it reads the same map: deferring the freshness check while leaving the coverage check on every push defers nothing.
<!-- /gate -->

**`closure_gates` does not touch CI, deliberately.** It defers what QA replays by hand, and CI time is not QA time: a machine re-running `audit` on every push costs nothing and reports early, while an agent replaying it per issue costs the run. Deferring both from the same key would have removed a security gate from every push to save an agent one command.

So a gate you list there still runs on every push, and stops being replayed per issue. If your CI is slower than you expected, that key is not where to look — this document claimed otherwise until a real port's QA read the code and found the two had been decoupled without the sentence being rewritten.

The trap is not a red gate, it is a green one: **a `--check` that compares an empty map to an empty map exits 0**. Count the files under your roots against the entries rendered, once, before trusting it.
<!-- /brief -->

<!-- brief:implementer,qa -->
## Comments: the contract survives, narration expires

<!-- gate:doc_lint -->
`doc_lint` requires a contract on every exported symbol — description, one entry per parameter, a return when the function yields one. Renaming a parameter without its documentation fails.
<!-- /gate -->

`duplication` refuses a block repeated across the codebase. It is the reuse note made checkable: every prompt demands one for any creation, and until this gate existed that note was judged in review, which means it was judged when someone remembered to look. Read what it finds before touching its threshold — on this repository the first run surfaced an e2e bootstrap copied into three suites, while the project map already advertised the harnesses as reusable.

<!-- gate:comment_policy -->
`comment_policy` refuses the opposite: describing what the code does, banners, section dividers, commented-out code, a `TODO` with no linked issue. **Narration describes today's implementation and lies tomorrow.** The why goes into the commit message; a trap already paid for goes into the profile's pitfalls document.
<!-- /gate -->

A non-exported function carries neither contract nor narration. If its body needs to be told, its name or its decomposition is what is wrong.
<!-- /brief -->

<!-- brief:product,qa -->
## What no tool proves

Gates catch what is missing far better than what is wrong. A missing contract fails; a wrong abstraction passes. A test that asserts nothing passes coverage; only a mutation gate sees it.

So there is a residue, and it is where review earns its place: whether the decomposition holds, whether an abstraction was worth its price, whether two decisions that are each defensible compose, whether a limit accepted deliberately is still acceptable.

**Quality is a command that fails or a proof that is demanded, never an adjective.** Where neither exists, say so instead of implying the gates covered it.
<!-- /brief -->
