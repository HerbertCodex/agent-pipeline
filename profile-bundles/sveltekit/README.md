# SvelteKit compatibility contract

This executable contract admits the official minimal TypeScript SvelteKit scaffold
with ESLint, Prettier, unit Vitest, Playwright and the Node adapter. Generate it with
the exact command in `compatibility.json`, install dependencies, then run:

```sh
node agent-pipeline/profile-bundles/sveltekit/verify.mjs
```

The verifier reads installed packages, not dependency ranges, and refuses unknown
majors, prereleases, missing official scripts, Node outside 22 and npm outside 11.
Passing establishes stack compatibility only. The project's product architecture,
design tokens, accessibility routes, persistence, security targets and thresholds
remain project decisions. Materialize the generic frontend contract, calibrate those
project-owned gates, and keep the detected versions in the profile.

The initial contract was measured on 2026-09-09 using Svelte's documented `sv create`
command. See `VALIDATION.md` for exact resolved versions and gate timings. Widening a
range requires a fresh official scaffold probe; a passing project does not silently
rewrite this manifest.
