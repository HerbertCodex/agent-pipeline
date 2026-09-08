# Relational database governance

Agent Pipeline governs a relational model without owning its ORM or SQL dialect.
The physical schema and migrations remain project-owned. A reviewed JSON contract
records the domain facts that source inspection cannot prove, while project-owned
commands exercise the real database.

The default for an OLTP model is 3NF. BCNF, 4NF and 5NF are selected only when the
declared dependencies require them. A denormalized field is accepted only with a
decision, a representative benchmark that improves latency, a consistency strategy
and a review trigger. This follows the practical trade-off described by
[IBM](https://www.ibm.com/fr-fr/think/topics/database-normalization) and the
[normal-form overview](https://fr.wikipedia.org/wiki/Forme_normale_%28bases_de_donn%C3%A9es_relationnelles%29):
normalize first, then measure the complete workload before retaining an exception.

## What the core proves

`data-model-check.mjs` validates:

- primary, candidate and composite keys;
- relation fields, arity and referenced unique keys;
- declared functional dependencies against 2NF, 3NF and BCNF rules;
- declared multivalued dependencies for 4NF and lossless evidence for 5NF;
- atomic-value and no-repeating-group attestations;
- non-null UTC `created_at` and `updated_at`, with reviewed exemptions;
- a secret-free append-only audit shape and its retention decision;
- user or tenant ownership and deny-by-default authorization policy;
- declared filters, supporting indexes, query budgets and plan evidence;
- measured denormalization exceptions;
- least privilege, separate migration identity, TLS and a private database network, with reviewed `not_applicable` values only for local engines that lack those boundaries;
- expand-contract migration policy, lock budget and recovery decision.

The core does not parse every ORM or pretend that a functional dependency can be
discovered from column names. The agent derives those facts from the domain and
records them for review. Executable project gates prove behavior against the real
database: anomalies, authorization, performance, database security and restoration.
The generated report labels those controls `proof_required` until their commands run.

SQLite and another process-local engine may mark TLS, database roles or a separate
migration identity `not_applicable` in the reviewed security decision. Parameterized
queries, deny-by-default authorization and a non-public database boundary remain
mandatory.

## Configure a project

Start from
[`templates/data-model-governance.template.json`](../templates/data-model-governance.template.json).
Replace the example with observed project paths, entities, access patterns, decisions
and existing command keys. The referenced schema, decisions and query-plan evidence
must already exist. Each proof gate must name a real project command.

```bash
node agent-pipeline/scripts/configure-data-model.mjs reviewed-data-model.json
node agent-pipeline/scripts/apply-profile.mjs
node agent-pipeline/scripts/data-model-check.mjs
node agent-pipeline/scripts/render-data-model.mjs docs/data-model.contract.json data-model.html
```

The configurator refuses to overwrite a v2 contract. It adds the `data_model` gate,
high-risk paths, human-review paths and CI evidence artifact. It preserves the
application, dependencies, migrations and existing proof commands.

The latest report is written to `pipeline/evidence/data-model/latest.json` by
default, beside a uniquely named per-run history record. Both record the Git revision
and working-tree state along with each control and proof gate. Reports are local/CI
evidence and are ignored by Git.

## Required project-owned proofs

The reviewed contract maps five obligations to commands already supported by the
project:

| Proof | Minimum behavior |
| --- | --- |
| `anomalies` | Real insertion, update and deletion scenarios plus database constraints and timestamp behavior. |
| `authorization` | Two ordinary identities or tenants cannot read or modify one another's records; client ownership parameters cannot bypass scope. |
| `performance` | Representative data, real filters and sorts, query plans, latency budgets and pagination behavior. |
| `database_security` | Parameterized queries, runtime/migration role separation, least privilege, TLS/network configuration and secret handling. |
| `backup_restore` | A backup is restored into an isolated environment and its integrity is checked. |

Anomalies, authorization and database security replay on every governed schema
change. Performance and restoration can run at closure because they are usually
more expensive. The contract declares the replay point; `apply-profile.mjs` refuses
a configuration that silently defers a per-issue proof.

ZAP complements these controls at the HTTP boundary. Authenticated scenarios should
exercise ownership identifiers and filter inputs, but ZAP does not prove database
constraints, query plans, role grants or restoration. See
[dynamic security testing](security-testing.md).

## Updating an existing installation

Legacy `data_model` configuration remains accepted. It continues to enforce schema,
migration, integration, 3NF-target and UTC timestamp declarations. Governance v2 is
activated only through the reviewed configurator, so updating Agent Pipeline does
not suddenly block an established project on historical gaps.

Run the following prompt at the application repository root:

```text
Update this existing Agent Pipeline installation and configure relational database
governance v2 where the project owns a relational database.

Preserve source, architecture, dependencies, lockfiles, migrations, local changes,
tracker data and existing CI behavior. Read repository instructions and Git status
first. Update Agent Pipeline only through its documented pinned update or migration
path; do not restart initialization or overwrite project configuration.

Read agent-pipeline/docs/database-governance.md and inspect the actual schema, ORM,
migrations, database tests, CI and deployment configuration. Identify the workload
as OLTP, OLAP or mixed. Use source evidence for tables, fields, keys, foreign keys,
constraints, indexes, filters, sorts, pagination, ownership, sensitive data,
timestamps, audit behavior and migration strategy.

Ask focused questions, using the platform's interactive question facility, for
domain facts source cannot prove: candidate keys, functional or multivalued
dependencies, retention, tenant boundaries, performance budgets, representative
volumes, acceptable lock time, secret provider, network policy and restoration
expectations. Continue after I answer; I must not submit another setup prompt.

Do not redesign the database or repair all historical debt during configuration.
Record the existing state as baseline. Create or reuse real project commands for
insertion/update/deletion anomalies, cross-user or cross-tenant authorization,
representative query plans and latency, database security, and isolated backup
restoration. Do not use mocks to claim a database behavior. Do not add a dependency
or replace independently maintained CI without a decision.

Prepare reviewed-data-model.json from the shipped template. Every entity must carry
created_at and updated_at in UTC unless a committed decision exempts it. Sensitive
operations use a secret-free append-only audit record with actor, action, resource,
time and correlation ID. Every public filter belongs to a named access pattern with
a supporting index or a measured exception. User and tenant access patterns include
their ownership field. Parameterized queries, least privilege, a separate migration
identity, TLS (or a reviewed process-local exception), private database networking
and deny-by-default authorization are mandatory.

Normalize OLTP entities to 3NF by default. Declare domain dependencies and let the
contract checker evaluate stronger forms when relevant. Keep a denormalization only
with representative before/after evidence, consistency handling and a review
trigger.

Run configure-data-model.mjs, apply-profile.mjs, data-model-check.mjs, the five named
proof gates and render-data-model.mjs. Retain commands, durations, revision, results,
pre-existing failures and limitations. Do not hide a failure, lower a budget or
claim that a configuration declaration proves runtime behavior.

Finish with changed files, proof results, baseline limitations, generated report
and diagram paths, and exact replay commands. Do not launch feature agents, import
historical debt into the backlog, commit, merge or push during this configuration.
```
