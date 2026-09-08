# Frontend TypeScript reference profile

This bundle defines the quality surfaces expected of a TypeScript frontend
without selecting React, Vue, Svelte, Angular or another framework.

It is a contract, not a drop-in toolchain. Its commands name the compiler,
linter, component runner, browser runner, accessibility checker and visual
regression surfaces a real project must implement.

## Materialize a profile for the detected stack

For an existing or newly scaffolded TypeScript frontend, generate a reviewable
project-owned bundle from the repository root:

```bash
node agent-pipeline/profile-bundles/frontend-typescript/materialize.mjs \
  pipeline/profile-candidates/frontend
```

The command reads `package.json`, `tsconfig.json`, the package-manager evidence,
source roots and installed or declared frontend packages. A React application
built with Vite therefore produces a profile named `frontend-react-vite`. Only
effective package scripts are mapped to gates; absent end-to-end, accessibility
or visual checks remain explicitly absent. The host project is not modified.

Review `pipeline/profile-candidates/frontend/DISCOVERY.md`, implement and prove
the missing mandatory gates with the project's real tools, then import the
candidate through the normal mechanism:

```bash
node agent-pipeline/scripts/import-profile.mjs \
  pipeline/profile-candidates/frontend
```

The generic Agent Pipeline project-map implementation is selected unless the
project carries its own real `project-map` writer. The generated bundle keeps
`calibration_required: true`; stack detection is not calibration evidence.

## Import the complete reference contract

Import it from the host repository:

```bash
node agent-pipeline/scripts/import-profile.mjs \
  agent-pipeline/profile-bundles/frontend-typescript
```

Direct import installs every reference command and is useful when the project
already implements that complete npm script contract. It deliberately sets
`calibration_required: true`. Before changing that flag, the bootstrap agent
must:

1. replace commands that do not match the selected stack;
2. implement every referenced package script;
3. remove source roots that the project does not carry;
4. choose and persist the architecture and design-system decisions;
5. create the project-specific `pitfalls.md`;
6. make each gate fail once on a deliberate defect;
7. run `preflight.mjs` and the final installation checkpoint.

A green script name with no effective checker behind it is not a gate.

## Dead code with Knip

Use [Knip](https://knip.dev/) as the primary implementation of the bundle's
`check:dead-code` script. It follows the JavaScript and TypeScript module graph
and covers unused files, exports and dependencies more accurately than the
framework's dependency-free shape matcher.

Knip is the pre-authorized dead-code dependency for this stack, so its
installation does not require an operator interruption. Resolve and inspect
the registry's current release at installation time, then install and verify it
with:

```bash
npm view knip@latest version engines deprecated dist.integrity
npm install --save-dev knip@latest
npm ls knip --depth=0
npm audit
```

Refuse deprecated or runtime-incompatible releases. The installed version must
equal the registry's `latest` resolution, and the audit must include development
dependencies. An audit proves only the absence of published advisories at that
time. If Knip or its transitive graph has a known vulnerability with no safe
release, undo only its installation, record the blocker and use the generic
fallback; never suppress the advisory.

Start from Knip's detected defaults and the actual framework plugins. Inspect
the project's manifests, entry points, tests, generated files and workspaces
before writing `entry` or `project`; never copy another project's patterns.
Expose `"check:dead-code": "knip"` in `package.json`, keep
`commands.dead_code` pointed at `npm run check:dead-code`, and prove non-zero
exits with an unused file, an unused export and an unused dependency. Every
false-positive exclusion stays narrow and carries a reviewable reason.
