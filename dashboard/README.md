# Live dashboard

The dashboard is a local surface over the portable NDJSON events emitted by
`dispatch.mjs`. It owns no scheduler and writes no pipeline state.

## Native use

When the framework is installed inside the host project:

```bash
cd /path/to/project
node agent-pipeline/dashboard/server.mjs
```

When the framework repository sits next to the host project:

```bash
cd /path/to/project
node ../agent-pipeline/dashboard/server.mjs
```

The module resolves its own framework scripts from its file location while
keeping the current directory as the host project. A test runs this exact
sibling layout and asserts that the dispatched process works in the host.

Open `http://127.0.0.1:4399`. Use `--port <number>` when that port is
already allocated. Runtime output stays in memory and disappears
when the server stops. The durable state remains the configured store.

## Docker Compose

From the framework repository, point Compose at the absolute host-project
path:

```bash
AGENT_PIPELINE_PROJECT=/absolute/path/to/project \
  docker compose -f dashboard/compose.yaml up --build
```

From a project carrying `agent-pipeline/`:

```bash
AGENT_PIPELINE_PROJECT="$PWD" \
  docker compose -f agent-pipeline/dashboard/compose.yaml up --build
```

Set `AGENT_PIPELINE_DASHBOARD_PORT` to change the published host port while
the container continues to listen on `4399`.

The project is mounted read-write at `/workspace`, because an Implementer
must be able to change it. The Docker socket is never mounted. The container
listens on all of its own interfaces, but Compose publishes it only as
`127.0.0.1:4399` on the host.

## What the image contains

The base image contains Node, Git and the pipeline. It deliberately does not
install a vendor agent CLI or the host project's toolchain.

The page and health endpoint work immediately. Dispatch works only when
`agent_runtime.command`, its credentials and every project command it needs
also exist inside the container. Build a derived image for that environment;
do not bake tokens into it:

```dockerfile
FROM agent-pipeline-dashboard:local

USER root
# Install the selected agent CLI and the host-project toolchain here.
USER node
```

Mount credentials through the mechanism recommended by the selected runtime,
preferably read-only. A host executable cannot be invoked merely because its
project directory is mounted.

## Security boundary

- Native mode refuses a non-loopback bind.
- Container mode must opt in with `--allow-non-loopback`.
- Mutating requests carry a random same-origin token.
- Issue ids and roles are validated before spawning.
- Dispatch uses an argument vector with `shell: false`.
- Agent output is inserted with `textContent`, never as HTML.
- The page has no external script, stylesheet or network dependency.

Publishing the container port without the `127.0.0.1:` prefix changes that
boundary and should be treated as a deliberate deployment decision.
