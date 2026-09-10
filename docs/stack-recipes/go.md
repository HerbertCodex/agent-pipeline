# Go recipe

A starting mapping of the mandatory gate keys to the usual Go toolchain. This is knowledge, not an adapter: the project-owned profile, its calibration on the real repository, and the negative proof of each gate remain mandatory, as [the installation guide](../nouveau-profil.md) prescribes.

| Gate key | Usual command | Note |
| --- | --- | --- |
| `check` | `go vet ./...` | The compiler checks types on every build; `vet` is the analysis pass worth a key of its own. |
| `lint` | staticcheck, plus `gofmt -l` for form | staticcheck catches what vet does not; keep the formatter check explicit so the negative proof can target it. |
| `build` | `go build ./...` | |
| `test_unit` | `go test ./...` | |
| `audit` | `govulncheck ./...` | Reaches call graphs: it reports a vulnerability only when the vulnerable symbol is reachable, which keeps the signal honest. |
| `secrets_scan` | gitleaks or trufflehog | Stack-neutral; the same choice as every other recipe. |
| `project_map` | project-owned generator | See below. |
| `design_limits` | gocyclo, plus project bounds | gocyclo covers cyclomatic complexity; function length, parameter count and nesting depth are calibrated with a project linter configuration or a small project script. |
| `duplication` | the shipped `duplication.mjs`, or `dupl` | The shipped scanner knows no language and works on any tree with real `roots`. |

`gosec` is the ecosystem's static security scanner: wire it behind an optional `sast` key rather than stretching `lint` to mean three different things.

## The project map

The map generator must parse Go, or it reads nothing. Two honest paths:

- a project-owned script using the standard library `go/ast` and `go/doc` packages — parsing the language in the language is the intended way, and doc comments come with the tree;
- the shipped pattern generator `agent-pipeline/scripts/project-map.mjs` with `extensions: [".go"]` declared — it recognises `func` and exported type shapes and says on the map itself what it cannot see.

The trap to refuse is the empty map: a generator collecting zero files produces a document that `--check` compares empty to empty and passes. `map-coverage.mjs` is what separates an empty map from an up-to-date one. The full reasoning is in [the map section of the installation guide](../nouveau-profil.md#the-project-map-you-must-write-it-and-this-is-not-negotiable) and [the shipped generator's limits](../nouveau-profil.md#the-project-map-and-the-generator-the-framework-ships).

## What does not change

Attempt isolation (`git-worktree`), the CI template (the Go steps are the project's placeholder lines), and the tracker adapters are stack-neutral: configure them exactly as for any other stack.
