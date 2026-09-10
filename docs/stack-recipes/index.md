# Stack recipes

The pipeline core knows no language: gate keys are stable, the command behind each key changes with the stack. When the client stack is one the shipped adapters do not cover, the expensive part of the installation is not the framework — it is choosing which tool answers each mandatory gate. These recipes carry that choice as knowledge, so a first installation starts from a mapping instead of an afternoon of research.

**A recipe is knowledge, not an adapter.** Nothing here runs: no script is added to the core, no command is installed. The project still writes its own profile, calibrates it on its own repository, and proves every gate can fail — the full procedure and its negative proofs are in [the installation guide](../nouveau-profil.md). A tool named here that turns out to be the wrong one for the project is replaced; the gate key is not.

The mandatory keys, refused if absent from `commands`: `check`, `lint`, `build`, `test_unit`, `audit`, `secrets_scan`, `project_map`, `design_limits`, `duplication`.

| Recipe | Ecosystem |
| --- | --- |
| [Rust](rust.md) | cargo, clippy, cargo-audit |
| [JVM](jvm.md) | Maven or Gradle, SpotBugs, OWASP dependency-check, ArchUnit |
| [Go](go.md) | go tool, staticcheck, gosec, govulncheck |
| [Python](python.md) | mypy, ruff, pytest, pip-audit |

Three things never appear in a recipe, because they do not depend on the stack: attempt isolation (`git-worktree`), CI rendering (the stack's steps stay a placeholder the project fills), and the tracker adapters. They are configured exactly as the installation guide describes, whatever the language.
