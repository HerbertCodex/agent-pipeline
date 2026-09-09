# SvelteKit adapter validation

Validated on 2026-09-09 with Node 22.23.2, npm 11.19.0 and Svelte CLI 0.17.0.

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

Playwright reported missing optional host libraries while still running its bundled
Chromium and passing the generated browser test. That warning is an environment
observation, not hidden as a successful dependency check.
