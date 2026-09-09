# Codex runtime adapter

This bundle connects Agent Pipeline's portable task package to Codex CLI without
making the core depend on Codex. Configure it from the host project:

```json
{
  "agent_runtime": {
    "prompt_adapter": "portable",
    "command": "node",
    "args": ["agent-pipeline/runtime-bundles/codex/adapter.mjs", "{role}", "{package}"],
    "prerequisites_in_agent": true
  }
}
```

The executable refuses a package outside the current attempt worktree, a Git
directory belonging to another attempt, unsupported roles and toolchains outside
[`compatibility.json`](compatibility.json). It grants writes only to the worktree
and the precise shared Git metadata needed for that attempt branch. Network access
is proxied and limited to localhost. HTTP clients use that proxy normally. Raw TCP
clients, including PostgreSQL drivers, must explicitly support the sandbox's
`ALL_PROXY` SOCKS endpoint, use a project-owned loopback relay through it, or use a
project-owned Unix-socket arrangement. A raw
TCP prerequisite that cannot do so fails before dispatch; host reachability is not
misreported as agent reachability.

The released contract is deliberately narrow: Linux with Git, Node 22.23.2 through Node 22,
and Codex CLI 0.153.4 through 0.153.x. It was exercised with `codex-cli 0.153.4` on
2026-09-09. The command surface (`--strict-config`, `--ask-for-approval never`,
ephemeral execution and configuration overrides) was checked against that installed
CLI. A newer minor is not assumed compatible; probe it and widen the manifest in a
reviewed release.

Projects that relay a raw TCP dependency through Codex's SOCKS proxy may declare
OpenBSD netcat as a project prerequisite; HTTP-only projects do not need it.

When `runtime_prerequisites` are present in the task package, the adapter executes
each argument array itself through `codex sandbox` before starting the agent. A
failed probe prevents the run; start/pass events and command output remain in its
log. This contract is why the host may set
`prerequisites_in_agent: true`; another adapter must not copy that claim unless it
provides the same behavior.

Do not disable `features.network_proxy` merely to make a raw TCP probe pass. With
Codex CLI 0.153.4 that exposes general outbound networking even when the profile
lists only localhost. The safe outcomes are a proxy-aware client, a project-owned
relay or Unix socket, or an infrastructure block.
