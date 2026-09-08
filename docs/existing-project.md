# Adopt Agent Pipeline in an existing project

Run your coding agent from the host repository root and give it the prompt below.
It applies to existing projects regardless of framework. The Nest adapter is an
optional shortcut, not a requirement. Other stacks still need profile configuration;
this prompt does not introduce an automatic universal installer.

The [French README](../README.fr.md#installer-dans-un-projet-d%C3%A9j%C3%A0-avanc%C3%A9-toutes-stacks)
contains the French version. See the [profile configuration guide](nouveau-profil.md)
for the required controls and the [release policy](releases.md) for version pinning.

## Copyable installation prompt

```text
Install and configure Agent Pipeline in this existing project, preserving its
architecture, conventions and tools.

The objective is to govern future features and fixes. This task includes neither
an application redesign nor feature development.

First read the repository instructions, then inspect:
- the languages, frameworks and versions actually used;
- the project structure and any modules or workspaces;
- existing build, test, lint and other verification commands;
- CI, conventions and architecture documentation;
- Git status and local changes that must be preserved.

Use observed files as evidence. Do not assume NestJS or impose a starter-project
layout on this repository.

Read the documentation and scripts of the installed Agent Pipeline version. If
absent, add the official repository using its documented installation and version
pinning procedure:
https://github.com/HerbertCodex/agent-pipeline

Use the initialization path actually available:
- reuse a compatible profile when it fits this project;
- otherwise configure a project profile using the existing tools;
- for a TypeScript frontend, materialize the shipped generic frontend contract
  into a technology-specific candidate before completing its missing gates;
- do not build a complete framework adapter just for this installation;
- do not modify the Agent Pipeline core to bypass an incompatibility;
- if a pipeline is already installed, inspect it and use its supported update or
  migration path instead of overwriting it or restarting initialization.

Prefer commands already defined in project scripts, wrappers and CI. Reuse tools
before creating new ones. Generate common files with the pipeline scripts; do not
handwrite outputs those scripts can generate.

Preserve source, tests, dependencies, agent instructions and existing CI. Inspect
conflicts before modifying files. Request a decision only when an important choice
cannot be inferred from the repository, including adding a dependency or replacing
an existing configuration.

Establish a baseline of the controls:
- executed commands and durations;
- passing controls;
- pre-existing failures;
- unavailable controls and configuration still required.

Do not hide failures, lower thresholds or substitute commands that succeed without
checking anything. Do not repeat expensive verification unless a change or an
unresolved failure justifies it. Record the revision and relevant working-tree
changes associated with the baseline.

If the pipeline requires a control the project does not have, identify the exact
gap. Do not claim installation is complete while a mandatory prerequisite remains
unsatisfied. Do not expand this installation into repairing all historical debt.

Configure permissions and reservations for the actual project paths. Configure
attempt isolation and evidence retention according to the available capabilities.

If this repository exposes a web application or API, read
agent-pipeline/docs/security-testing.md. Inspect the existing test environment,
health endpoint, authentication, test-user provisioning, API definitions and
external side effects. Ask me focused questions for decisions the repository cannot
prove, especially destructive-scan authorization and secret provisioning. Do not
guess a target or credential. Materialize the reviewed contract with
configure-security.mjs; do not launch an active scan during installation.

When Agent Pipeline is already installed, use the complete
[copyable update and security prompt](security-testing.md#copyable-prompt-for-an-existing-installation).

If the repository owns a relational database, also read
agent-pipeline/docs/database-governance.md. Inspect the real schema, migrations,
domain keys and dependencies, timestamps, audit, ownership, exposed filters,
indexes, query plans, database identities, network policy and restoration process.
Ask for the domain and operational decisions that files cannot prove, then prepare
the reviewed v2 input and run configure-data-model.mjs. Do not redesign the schema
or convert historical debt into backlog work during installation. The guide includes
a dedicated [copyable update prompt](database-governance.md#updating-an-existing-installation).

Finish with:
1. Created or modified files and their purpose.
2. Verification results and remaining limitations.
3. Exact commands to start the pipeline and its dashboard.
4. Decisions, if any, required before the first task.

Do not automatically import technical debt into the backlog. Do not launch
development agents, implement features, commit, merge or push during installation.
```
