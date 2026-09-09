# Setup validation

The original baseline below was measured locally on 2026-09-07, Linux x64, Node 24.20.0. The released compatibility probe was revalidated on 2026-09-08 with Node 22.23.2 after the CI failure described under Compatibility lifecycle.

## Complete Nest 11 installation

The reference host was generated using the official `@nestjs/cli@11.0.24`, with npm and strict TypeScript. A clean copy of its generated application reused the already installed dependencies and started with a fresh Git repository and no pipeline or tracker. The framework was linked at `agent-pipeline/`.

```sh
node agent-pipeline/scripts/setup.mjs --runtime claude-code
```

The complete installation, including tracker initialization and final checks, returned exit 0 in **40.371 seconds**. This excludes scaffolding, dependency downloads and installation of the tracker CLI. An earlier run with the tracker already initialized took 34.749 seconds. These are local observations, not latency guarantees.

All declared gates executed successfully. The generated policy, four role prompts, four briefs, installed skills and both hooks passed their consistency checks. Store verification passed and the scheduler reported no actionable issue. The scaffold's existing lint warning was displayed, with its original severity unchanged. Hash comparison confirmed that original source files, tests, package manifest, lockfile, TypeScript configuration and lint configuration were unchanged.

## Refusal and recovery

The adapter's `verify.mjs` exercised actual failures for types, build, syntax, unit and HTTP integration assertions, function limits, secret tokens, duplication, stale maps and unexpected HTTP status. Every probe was refused and removed. The TypeScript parser was also exercised independently against all four design bounds.

A separate recovery probe added an invalid assignment to the installed host. Running setup again returned exit 1 at type checking in 6.063 seconds and left a failed report. After removing the probe, the same command returned exit 0 in 41.672 seconds. The selected Claude Code runtime was retained even with its flag omitted, and pre-existing installation files remained identical.

## Nest 12

A second host was generated with `@nestjs/cli@12.0.0` and installed Nest core 12.0.1. Its real Oxlint, build, Vitest unit and HTTP integration tests, and compiled-application smoke test passed when exercised individually.

The generated HTTP test imports `supertest/types`. The production configuration uses NodeNext resolution, under which the direct strict check could not resolve that test-only import. The adapter now checks a Vitest test graph with TypeScript's `Preserve` module mode and `Bundler` resolution; the separate `nest build` gate retains the scaffold's production NodeNext configuration. This passed without changing the application, dependencies or test coverage.

The complete setup was repeated on 2026-09-08 with Node 22.23.2, npm 11.19.0, TypeScript 6.0.3, Vitest 4.1.11 and Oxlint 1.82.0. Type checking, lint, build, unit, HTTP integration, smoke, design, secrets and static analysis passed. Setup then stopped at `npm audit --audit-level high`: the generated dependency graph reported high-severity `tmp` and `undici` advisories through `@nestjs/mau`, with only a forced breaking downgrade offered. The audit was not weakened, and Nest 12 was not added to the released support manifest.

## Automated checks

The dependency-free core suite covers adapter detection, preview without writes, prerequisite and layout refusal, bootstrap preservation, configuration conflicts, symlink refusal, changed generated policy, package-manager ambiguity, process timeouts, secret shapes and design bounds. The project-map coverage regression checks that its source extensions agree with the generator. The real Nest probes complement these fixture tests; they are not simulated package-manager successes.

To repeat the complete check, follow the disposable-host procedure in [README.md](README.md). Preserve the setup report and installed dependency versions alongside any new timing measurement.

## Compatibility lifecycle

The manifest-driven supported probe was executed locally on 2026-09-08 using `ci.mjs --case nest11-node22-npm11-jest30-eslint9` with Node 22.23.2. Official scaffolding took 16.841 seconds. Installation took 7.723 seconds, the negative proofs 5.660 seconds, the healthy rerun 6.940 seconds and the adapter migration 7.160 seconds. The migration retained the local `language: "fr"` setting and passed all gates.

The earlier 2026-09-07 Node 24.20.0 probe passed on one local machine, but the GitHub runner later reproduced a native cleanup abort in Sudocode 0.2.0's `better-sqlite3` 11.x dependency immediately after tracker initialization. Node 24 was removed from the support contract because a supported combination must be reproducible in CI. The manifest now records the tracker and its admitted Node range as a runtime dependency, and validation rejects any stack case that exceeds that range.

The separate latest candidate probe resolved CLI 12.0.0 and Nest 12.0.1. It passed the corrected test resolution and stopped only at the high-severity dependency audit described above. Its report remained candidate evidence, and the released support manifest was unchanged.

The complete dependency-free repository suite passed 641 tests with no failures or skips under Node 22.23.2. It includes compatibility bounds, runtime-dependency constraints, Vitest module resolution, unknown-version refusal, migration conflicts, local-change preservation and restoration of managed files after a failed update.

## Revalidation of 2026-09-09: Node 24 and Nest 12

Measured on Linux x64. Local probes ran on Node 24.20.0 with npm 11.19.0; runtime probes ran on GitHub runners. The scaffold and remediation measurements below are runtime-independent; the supported range remains Node 22.

### The tracker still aborts on Node 24

An isolated probe on a GitHub runner ([run 34326800080](https://github.com/HerbertCodex/agent-pipeline/actions/runs/34326800080)) had two consecutive `sudocode init` invocations return 0 on **Node 24.21.0**, which suggested the 2026-09-07 blocker had lifted. It had not. Promoting Node 24 and running the complete probe reproduced the abort ([run 34327707072](https://github.com/HerbertCodex/agent-pipeline/actions/runs/34327707072)): the tracker initializes and applies its five migrations, then the process dies during environment cleanup.

```
node[2622]: void node::RemoveEnvironmentCleanupHook(...) at ../src/api/hooks.cc:142
Assertion failed: (env) != nullptr
  Statement::~Statement() [.../@sudocode-ai/cli/node_modules/better-sqlite3/build/Release/better_sqlite3.node]
```

An isolated initialization is therefore not evidence for this runtime: only the complete setup exercises the statement lifetime that aborts. `@sudocode-ai/cli` is unchanged at 0.2.0 and still resolves `better-sqlite3` 11.10.0. **Node 24 stays outside the contract**, and the supported range stays on Node 22.

The isolated run also recorded that **Node 22.23.2 ships npm 10.9.8**. Every supported case required npm 11.19.0, so no runtime inside the previously declared node range could satisfy the declared toolchain. The fixture suite ran under a toolchain the adapter rejects and reported that as a failure of the code under test. The contract job now provisions the declared manager before running the suite, exactly as the supported matrix does, and `adapter-compatibility.test.mjs` refuses a runtime admitted without an admitted package manager.

### The official scaffold fails its own audit gate

Both scaffolds were generated with the official CLI and audited unchanged:

| scaffold | `npm audit --audit-level high` |
| --- | --- |
| `@nestjs/cli@11.0.24`, Nest 11.2.3 | exit 1, 4 high, `multer` |
| `@nestjs/cli@12.0.0`, Nest 12.0.1 | exit 1, 10 high, `multer` and `@nestjs/mau` |

`@nestjs/platform-express` pins `multer` to exactly 2.2.0 in Nest 11 and Nest 12 alike, and four high-severity advisories apply to `<=2.2.0`. These advisories postdate the 2026-09-08 validation: the released manifest had become stale, declaring supported a toolchain that no longer passed its own gate.

The Nest 12 scaffold additionally ships `@nestjs/mau`, the `nest deploy` helper, whose `inquirer` → `external-editor` → `tmp` chain carries two high-severity advisories with **no fixed release available**. No override repairs it. Overriding `undici` cleared its own advisories but left that chain intact.

### Both toolchains pass once remediated

The manifest now declares two remediations, applied by the adapter and reported in the setup report. `multer` is raised to its **corrected** release 2.3.0 — the vulnerability is repaired, not suppressed — and `@nestjs/mau` with its `deploy` script is removed, because nothing in build, lint, tests or the running application depends on it.

| toolchain | audit | build | lint | test | test:e2e |
| --- | --- | --- | --- | --- | --- |
| Nest 11.2.3, TS 5.9.3, Jest 30.5.1, ESLint 9.39.5 | **0 vulnerabilities** | pass | pass | pass | pass |
| Nest 12.0.1, TS 6.0.3, Vitest 4.1.11, Oxlint 1.82.0 | **0 vulnerabilities** | pass | pass | pass | pass |

Nest 11 needs the `multer` override alone; it ships no deploy helper.

### What this revalidation does not establish

The end-to-end `ci.mjs` probe — official scaffolding, full installation, negative proofs, healthy rerun and adapter migration — was not rerun locally for either case. It runs in the `supported` matrix on the runner, and that job is the evidence for the released contract. Timings from the 2026-09-08 baseline above are not carried forward: they were measured on a different runtime.
