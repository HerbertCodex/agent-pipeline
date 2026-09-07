# Setup validation

Measured locally on 2026-09-07, Linux x64, Node 24.20.0.

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

The complete setup correctly stopped at type checking: the generated HTTP test imported `supertest/types`, which was not resolvable in that dependency graph. No source fix, dependency substitution, test exclusion or successful-installation claim was made for that scaffold.

## Automated checks

The dependency-free core suite covers adapter detection, preview without writes, prerequisite and layout refusal, bootstrap preservation, configuration conflicts, symlink refusal, changed generated policy, package-manager ambiguity, process timeouts, secret shapes and design bounds. The project-map coverage regression checks that its source extensions agree with the generator. The real Nest probes complement these fixture tests; they are not simulated package-manager successes.

To repeat the complete check, follow the disposable-host procedure in [README.md](README.md). Preserve the setup report and installed dependency versions alongside any new timing measurement.

## Compatibility lifecycle

The manifest-driven supported probe was also executed locally on 2026-09-07 using `ci.mjs --case nest11-node24-npm11-jest30-eslint9`. Official scaffolding, installation, negative proofs, a healthy rerun and an adapter migration all passed. The migration preview left the installed version unchanged; applying the disposable adapter update from 1.0.0 to 1.0.1 retained the local `language: "fr"` setting and passed all gates. The update itself took 37.532 seconds, excluding its parent process overhead.

The separate `latest` candidate probe resolved CLI 12.0.0 and Nest 12.0.1, with TypeScript 6.0.3, Vitest 4.1.11 and Oxlint 1.81.0. It failed at the unresolved `supertest/types` import described above. Its report marked it as a candidate, and the released support manifest was unchanged.

The complete native suite passed 627 tests with no failures or skips. It includes compatibility bounds, unknown-version refusal, migration conflicts, local-change preservation and restoration of managed files after a failed update. These are local results; the scheduled GitHub workflow has not been executed remotely as part of this validation.
