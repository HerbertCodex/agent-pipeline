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
