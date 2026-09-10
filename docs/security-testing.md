# Dynamic security and load testing

<!-- brief:orchestrator,product,implementer,qa -->
## One project-owned boundary

Dynamic testing is optional until the project declares a reachable web target. Once
declared, `security_testing` is the authority for the environment lifecycle, exact
allowed targets, authentication, ZAP image, scan budgets, reports, accepted
findings, and assurance level. Agents do not invent any of those values per task.

The configuration stores environment variable names, never credential values. A
dedicated seed command creates test identities in disposable data. The ZAP plan
uses its declared scan identity. Authorization-sensitive applications add a
project-owned role-matrix gate with two ordinary identities so access to another
user's resources can be tested. Administrative credentials exist only when that
role is part of the application and only in the disposable environment.

The target and API override must exactly equal an entry in `allowed_targets`.
Every scan requires disposable data with external side effects disabled; active
and API scans additionally require `allow_active: true`. The Docker image uses an immutable SHA-256 digest.
The runner never mounts the Docker socket.

The committed OWASP Top 10 2025 matrix is an assurance ledger, not a certificate.
Every category is `unverified`, `partial`, `verified`, or `not_applicable`, with
concrete controls and limitations. A green ZAP report covers only the reachable
runtime surface; it does not silently mark design, supply chain, cryptography,
logging, authorization, or exceptional-condition handling as verified.
<!-- /brief -->

## Configure after the project profile

Inspect the application, its existing test environment, authentication, API
definitions, CI, and external side effects first. Ask the operator only for values
that source evidence cannot establish: destructive-scan authorization, test-user
provisioning, forbidden side effects, role coverage, and the secret provider.

Prepare a reviewed JSON document containing `security_testing` and, optionally,
`load_testing`, then run:

```bash
node agent-pipeline/scripts/configure-security.mjs reviewed-security-config.json
node agent-pipeline/scripts/apply-profile.mjs
node agent-pipeline/scripts/security-scan.mjs check
```

The command refuses to replace an existing contract. It adds executable gate
commands, defers costly controls to closure, gives deep CI controls explicit event
schedules, seeds an empty accepted-finding ledger and an unverified OWASP Top 10
2025 matrix, calculates a CI timeout from the sequential scan budgets, and ignores
local reports and credential files.

`apply-profile.mjs` then regenerates pipeline-owned instructions, briefs and CI
from the updated configuration. Inspect and integrate an independently maintained
workflow instead of replacing it with the generated workflow.

## Copyable prompt for an existing installation

Run the agent at the root of the host application and give it the prompt below.
The prompt authorizes the migration and configuration work, while keeping target,
credential, external-effect and active-scan decisions explicit.

```text
Update the Agent Pipeline installation in this existing project and configure its
dynamic security and load-testing controls where they apply.

Preserve the application architecture, source, dependencies, lockfiles, local
changes, tracker data, product backlog and existing CI behavior. Do not restart
pipeline initialization and do not replace the application with a new scaffold.

First read the repository instructions and inspect Git status. Locate the installed
Agent Pipeline, determine whether it is a pinned Git submodule or a vendored copy,
record its current revision or version, and read its release and update
documentation. Inspect pipeline.config.json and determine whether this installation
has a versioned setup baseline and setup target hashes.

Update Agent Pipeline only through its documented, version-pinned procedure. Never
silently follow a moving branch. If the installed adapter supports migration, run
its read-only update preview first, inspect the proposed three-way merge, then apply
it when there is no conflict. Preserve independent project configuration. If this
is a legacy installation without the required baseline, do not rerun init or force
setup over it: inspect the exact gaps and perform a reviewed manual migration. Stop
and ask me only when a conflict or important choice cannot be resolved from the
repository.

After the framework is current, read agent-pipeline/docs/security-testing.md and
inspect the actual application before configuring security:

- reachable web and API surfaces, including internal container addresses;
- existing local, integration or preview test environments and health checks;
- database reset and deterministic test-data seeding;
- authentication flows, roles and creation of dedicated test identities;
- API definitions such as OpenAPI, GraphQL schemas or WSDL files;
- calls to email, payments, storage, webhooks and every other external side effect;
- existing security, end-to-end and performance commands;
- CI provider, secret names, workflow ownership and artifact policy;
- whether the application is server-rendered or requires a browser-aware spider.

Use repository evidence for every value. Never guess a credential, target, role,
production exclusion, scan permission or load threshold. Ask focused questions in
dependency order for facts the repository cannot establish. Use the agent
platform's interactive question facility when available and continue after I
answer; I must not have to submit another installation prompt.

Reuse the project's existing test environment when it is safe. Otherwise create
the smallest project-owned disposable environment, reset and seed commands needed
for repeatable testing. Disable real email, payments, webhooks and other external
effects. Adding a dependency or changing an independently maintained CI workflow
requires an explicit decision. Never target production or shared persistent data.

Prepare a reviewed JSON input for configure-security.mjs. Store only environment
variable names for credentials. Select an immutable ZAP image digest, an explicit
target allowlist, bounded scan durations and the appropriate traditional, Ajax or
client spider. Configure API scanning only from an observed definition. Configure
load testing with the project's own tool and explicit error, latency and throughput
thresholds; do not use ZAP as a load generator. For GitHub CI, resolve the official
artifact upload action to a full immutable commit SHA.

Run, in order:

1. the framework's complete core test suite;
2. configure-security.mjs with the reviewed input;
3. apply-profile.mjs to regenerate pipeline-owned instructions, briefs and CI;
4. security-scan.mjs check, which must pass before any traffic is sent;
5. the passive baseline scan against the disposable environment once its target and
   test credentials are available.

Do not run active, API-active or load tests until their exact disposable target,
side-effect isolation and authorization are confirmed. When authorized, run each
declared control once and retain its revision, duration, discovered coverage,
result and artifact names. Always stop the test environment, including after a
failed or interrupted control.

Do not hide pre-existing failures, weaken thresholds, add permanent suppressions,
claim that ZAP covers unreachable behavior, or mark OWASP categories verified
without a declared executable control. Record accepted findings narrowly with a
reason, acceptance date and expiry.

Finish with:

1. previous and resulting Agent Pipeline versions or revisions;
2. migrated, created and regenerated files with their purpose;
3. questions answered and security choices retained;
4. commands run, durations, results and pre-existing failures;
5. exact commands for baseline, active, API, load and dashboard use;
6. remaining limitations, unavailable controls and operator-managed CI secrets.

Do not implement product features, import historical debt into the backlog, commit,
merge, push or publish a release during this task.
```

Authentication environment names are also registered in `ci.secret_environment`;
generated GitHub CI reads values from secrets with the same names. The load target
is a non-secret `ci.environment` value. Creating those repository secrets remains
an operator action, and their absence makes the scan fail before the environment
starts.

The input may provide `ci_artifact_upload.uses`, pinned to the upload action's full
40-character commit SHA. When remote CI is enabled, profile rendering refuses an
unpinned uploader. Generated CI retains the sanitized `run.json` metadata even on
failure. Raw ZAP exchanges and reports can contain session material, so they remain
local and ignored unless the project explicitly establishes a more restrictive
artifact policy. A project with `ci.provider: "none"` keeps all records locally for
the dashboard.

The minimum shape is:

```json
{
  "security_testing": {
    "version": 1,
    "assurance": {
      "standard": "OWASP ASVS",
      "level": 2,
      "top10_2025": "pipeline/security/owasp-top10-2025.json"
    },
    "target": "http://app:3000",
    "allowed_targets": ["http://app:3000"],
    "environment": {
      "start": "<existing detached test-environment command>",
      "stop": "<existing cleanup command>",
      "prepare": "<existing test-data seed command>",
      "health_url": "http://127.0.0.1:3000/health",
      "health_timeout_seconds": 60,
      "disposable": true,
      "external_side_effects": "disabled",
      "network": "project-security"
    },
    "authentication": {
      "method": "form",
      "parameters": {
        "loginPageUrl": "http://app:3000/login",
        "loginRequestUrl": "http://app:3000/login",
        "loginRequestBody": "email={%username%}&password={%password%}"
      },
      "credentials": {
        "username_env": "ZAP_TEST_USERNAME",
        "password_env": "ZAP_TEST_PASSWORD"
      },
      "verification": {
        "method": "response",
        "logged_in_regex": "Sign out"
      }
    },
    "zap": {
      "image": "ghcr.io/zaproxy/zaproxy@sha256:<reviewed-64-character-digest>",
      "spider": "client",
      "reports_dir": "pipeline/evidence/security",
      "max_scan_minutes": 20,
      "max_rule_minutes": 3,
      "threads_per_host": 4,
      "fail_level": "High",
      "warn_level": "Medium",
      "exclude_paths": []
    },
    "accepted_findings": "pipeline/security/accepted-findings.json",
    "allow_active": true
  }
}
```

Choose `zap.spider` from `traditional`, `ajax`, or `client`. The client spider is
the default recommendation for JavaScript applications because it explores browser
actions and client-side routes. Use the traditional spider for server-rendered
sites and APIs whose navigation is exposed as links; use the Ajax spider only when
the project has already validated its browser and Selenium requirements.

Set `authentication.method` to `none` only for a deliberately public surface. Header
authentication uses `method: "header"` and `value_env`; the runner maps that value
to ZAP without placing it in Docker arguments. Form, JSON, HTTP, script, browser,
client, and auto-detected authentication use ZAP context parameters and environment
backed credentials. Every authenticated plan sends a request and fails unless the
configured logged-in response expression is observed.

For an API scan add `api.format` (`openapi`, `graphql`, or `soap`), `api.definition`,
and an optional allowlisted `api.target_url`. Local definitions are copied into the
isolated ZAP work directory. A remote definition must exactly match an entry in
`api.allowed_definition_urls`; a project-local definition is preferred.

### The application may need to run in a container too

The scanner always runs in a container, so the target address must be reachable
from a container, not only from the host. On a native Linux runner the default
bridge gateway (for example `172.17.0.1`) usually works. On Docker Desktop,
rootless Docker, or WSL2 it frequently does not: the gateway address is dead or
belongs to a virtual machine, `--network host` selects that machine's network
namespace rather than the host's, and NAT addresses such as `10.0.2.2` depend on
the runtime. The failure is environment-specific: the health check passes from
the host, every scan container then reports the target as down, and the contract
alone cannot explain why.

The pattern that works everywhere is to containerize the application under test
on the same user-defined network the contract declares:

1. `environment.start` runs the application container with
   `--network <declared network>` and `--network-alias app`;
2. the application container publishes its port on `127.0.0.1` so
   `environment.health_url` keeps working from the host;
3. `security_testing.target` and its `allowed_targets` entry become
   `http://app:<port>`, an address any container on that network resolves.

This pattern is stack-neutral: whatever builds the application's container image
is the project's own toolchain, and the contract only records the network name,
the alias and the port. Run `node agent-pipeline/scripts/security-scan.mjs probe`
after configuring: it validates the contract, starts and health-checks the
environment, then issues a single GET against the target from a container on the
declared network using the pinned scanner image, and stops the environment even
on failure. A probe failure names this pattern; a probe success means the scan
will see the target exactly as the probe did.

Load testing is a sibling object in the reviewed input:

```json
{
  "load_testing": {
    "version": 1,
    "command": "<project-owned load command>",
    "target_env": "LOAD_TEST_TARGET",
    "allowed_targets": ["http://app:3000"],
    "timeout_seconds": 300,
    "reports_dir": "pipeline/evidence/load",
    "summary_file": "summary.json",
    "result_files": ["summary.json"],
    "use_security_environment": true
  }
}
```

The command receives `PIPELINE_LOAD_EVIDENCE_DIR` and must write the declared files
there. The normalized summary contains numeric `requests`, `error_rate`, `p95_ms`,
`p99_ms`, and `throughput_per_second` metrics plus the thresholds applied. A
successful process that omits a file or metric is a failed gate, so an old or empty
report cannot stand in for a measurement.

When the project tool is k6, read the exported summary against the current format:
since k6 v0.49 `--summary-export` writes a flat JSON object, so a counter is
`metrics.<name>.count` and a rate such as `http_req_failed` is exposed as
`metrics.http_req_failed.value`; the pre-v0.49 `.values` nesting is gone. Trend
metrics only carry the statistics requested on the command line, so a `p99_ms`
reading requires
`--summary-trend-stats=avg,min,med,max,p(90),p(95),p(99)`; without it the export
silently lacks the percentile and the run cannot produce the normalized summary.

<!-- brief:orchestrator,qa -->
## Execution cost and evidence

<!-- gate:security_scope -->
`security_scope` validates the boundary, all ten assurance entries, and accepted
finding expiries without starting the application. An expired acceptance refuses
the run before traffic is sent.
<!-- /gate -->
<!-- gate:dast_baseline -->
`dast_baseline` runs exploration, authenticated-session proof, passive scanning,
and HTML, JSON, and SARIF reports. It is a closure gate and runs on pull requests in
generated CI.
<!-- /gate -->
<!-- gate:dast_active -->
`dast_active` adds bounded active attacks. It is a closure gate locally and is
scheduled or manually triggered in generated CI.
<!-- /gate -->
<!-- gate:dast_api -->
`dast_api` imports the declared API definition before a bounded active scan. It is
also scheduled or manually triggered in generated CI.
<!-- /gate -->
<!-- gate:load -->
`load` runs the project's chosen performance tool separately from ZAP. The command
receives the allowlisted target through its declared environment variable and an
isolated `PIPELINE_LOAD_EVIDENCE_DIR`. It must write every declared result file and
enforce its own throughput, error, and latency thresholds.
<!-- /gate -->

Every run records its target, authentication state, commit, timestamps, duration,
exit status, and artifact names. The dashboard reads only those whitelisted fields;
unknown fields, including secret-shaped additions, are not exposed.
<!-- /brief -->

## Accepted findings

Each accepted finding contains `rule_id`, exact `url`, `reason`, `accepted_at`, and
`expires_at`. Unexpired entries become narrow ZAP alert filters before exploration.
Expiration is mandatory: a permanent suppression turns a new regression into an
old conversation nobody reopens.

## Limits

ZAP is dynamic application security testing, not load testing. It cannot prove that
an unreachable route, missing authorization decision, unsafe design, vulnerable
build system, or unlogged security event is safe. The OWASP matrix keeps these gaps
visible and binds any verified claim to project-owned controls.

Sources: [OWASP Top 10 2025](https://owasp.org/Top10/2025/),
[ZAP Docker scans](https://www.zaproxy.org/docs/docker/about/), and
[ZAP Automation Framework](https://www.zaproxy.org/docs/automate/automation-framework/).
