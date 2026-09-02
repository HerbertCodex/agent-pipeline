# Frontend TypeScript reference profile

This bundle defines the quality surfaces expected of a TypeScript frontend
without selecting React, Vue, Svelte, Angular or another framework.

It is a contract, not a drop-in toolchain. Its commands target stable npm
script names so the bootstrap agent can map the project's actual compiler,
linter, component runner, browser runner, accessibility checker and visual
regression tool behind them.

Import it from the host repository:

```bash
node agent-pipeline/scripts/import-profile.mjs \
  agent-pipeline/profile-bundles/frontend-typescript
```

The import deliberately sets `calibration_required: true`. Before changing
that flag, the bootstrap agent must:

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
