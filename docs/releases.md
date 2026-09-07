# Releases and updates

agent-pipeline follows semantic versioning from `VERSION`. A Git tag with the same value, prefixed by `v`, identifies the exact framework revision installed in a project.

Prefer a pinned submodule for an updatable installation:

```sh
git submodule add https://github.com/HerbertCodex/agent-pipeline.git agent-pipeline
git -C agent-pipeline checkout v0.1.0
git add .gitmodules agent-pipeline
```

The host repository records the submodule commit. To update, fetch tags inside the submodule, review the release notes and diff, check out the chosen tag, rerun the framework tests and commit the new submodule pointer. Never track a moving branch implicitly in production.

Vendoring remains possible from a release archive, but the host must retain the version in a committed `agent-pipeline.version` file. Removing the nested `.git` without recording the source tag makes provenance and upgrades unverifiable, so it is no longer the recommended installation.

A release is published only after the release commit is merged, `VERSION` matches the intended tag, and the complete core test suite passes on that exact SHA. The tag and GitHub release are external publication steps requiring the operator's approval.
