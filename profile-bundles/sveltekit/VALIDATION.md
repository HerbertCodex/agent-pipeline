# SvelteKit adapter validation

## Contract baseline

The compatibility contract was measured on 2026-09-09 with Node 22.23.2, npm
11.19.0 and Svelte CLI 0.17.0.

Generator:

```sh
npx sv@0.17.0 create --template minimal --types ts --add eslint prettier vitest="usages:unit" playwright sveltekit-adapter="adapter:node" --no-download-check --install npm <temporary-directory>
```

Resolved stack: `@sveltejs/kit` 2.70.3, Svelte 5.57.0, Vite 8.2.2,
TypeScript 6.0.3, Vitest 4.1.11, Playwright 1.63.0, ESLint 10.10.0,
Prettier 3.9.6, `svelte-check` 4.7.6 and `@sveltejs/adapter-node` 5.5.7.

Observed baseline:

| Control | Result | Wall time |
| --- | --- | ---: |
| `npm run check` | 0 errors, 0 warnings | 2.61 s |
| `npm run lint` | passed | 2.57 s |
| `npm run build` | passed, Node adapter output | 2.85 s |
| `npm run test:unit -- --run` | 1/1 passed | 1.53 s |
| `npm run test:e2e` | 1/1 passed | 8.40 s |

Playwright reported missing optional host libraries while still running its
bundled Chromium and passing the generated browser test. That warning is an
environment observation, not hidden as a successful dependency check.

## Manual installation evidence, 2026-09-10

A real host went through the manual profile workflow on 2026-09-10 (Node
22.23.2, npm 11.19.1, same sv@0.17.0 scaffold). After the scaffold passed
`verify.mjs`, the remaining agent work — everything this installer now does —
was, in order:

1. install and calibrate knip for the `dead_code` gate;
2. add `@axe-core/playwright` and an axe spec (`e2e/a11y.e2e.ts`), and widen
   the Playwright `testMatch` — the default match ignores `*.e2e.ts`, and an
   explicitly named file is still filtered by `testMatch` (verified against
   Playwright 1.63.0);
3. author the design-limits ESLint config (complexity 10, max-params 4,
   max-depth 4, 50 lines per function, test files exempt, plus the two
   `no-restricted-syntax` selectors for derived-class unconditional throws and
   `instanceof` chains);
4. author the smoke script (start the adapter-node build on a free port,
   `GET /` must answer 200, kill the process group, fail when `build/index.js`
   is missing);
5. configure gitleaks with **explicit** rules — the 8.30.1 binary's built-in
   rule set matched nothing against AKIA…, ghp_… and PEM samples, so
   `.gitleaks.toml` carries the gate;
6. add the `.prettierignore` / `eslint.config.js` ignore entries for
   `agent-pipeline/`, `pipeline/`, `build` and the generated targets
   (`AGENTS.md`, `.github/workflows/ci.yml`, `docs/project-map.md`) —
   formatting a generated target is drift that `apply-profile --check` then
   refuses;
7. extend `file_policy.implementer.allow` with `e2e/**`, `static/**`,
   `mockups/**`;
8. negative-prove every new gate;
9. record the detected versions as calibration evidence.

Measured gate timings on that host: build ~3.7 s, check ~3.5 s, lint ~3.5 s,
unit ~2.7 s, e2e ~7.2 s.

One deviation from the manual installation is deliberate: it set
`testMatch: '**/*.e2e.{ts,js}'`, which silently stopped running the scaffold's
own `e2e/demo.test.ts`. The installer widens the match to
`**/*.{e2e,test,spec}.{ts,js}` instead, so the demo test keeps running.

## Automated checks

The dependency-free suite covers detection, contract admission and refusal,
layout refusal before writes, the undecided-design-system refusal, the
package.json merge (additions, keeps, clobber refusal, idempotence), the
ESLint/Playwright/Prettier ignore edits, the registry audit (deprecation,
engines, resolution) with an injected registry, and — through a fixture host
with stubbed executables — a complete `setup.mjs` installation: gates, all
seven negative proofs, the report, and an idempotent rerun listing its kept
files. No fixture simulates a registry or a package-manager success; the
stubs only make the host boundaries observable.

## What remains to calibrate by hand on a real host

A real run still needs a human decision and two pieces of evidence no fixture
carries:

- the `design_system` block in `pipeline.bootstrap.json` (a product decision);
- the actual registry answers and installed versions on the day, recorded in
  `pipeline/setup-report.json` and the profile's `detected` block;
- `knip.json` exclusions as the project grows past the official scaffold.

An end-to-end probe of the adapter itself (official scaffold → one command →
verified pipeline) has not yet been replayed on a disposable host the way
`profile-bundles/nest/ci.mjs` does for Nest; that run is the missing evidence,
not a gap in the gates.
