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
