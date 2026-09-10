# Python recipe

A starting mapping of the mandatory gate keys to the usual Python toolchain. This is knowledge, not an adapter: the project-owned profile, its calibration on the real repository, and the negative proof of each gate remain mandatory, as [the installation guide](../nouveau-profil.md) prescribes.

| Gate key | Usual command | Note |
| --- | --- | --- |
| `check` | `mypy .` | Only meaningful with strict settings enabled; a mypy configured permissive passes a type error and the negative proof will catch it. |
| `lint` | `ruff check .` and `ruff format --check .` | One tool, two invocations: analysis and form stay distinguishable in the output. |
| `build` | `python -m build` | An interpreted language still has a build: the packaged artefact is what proves imports, metadata and included files. A library without packaging may bind `build` to a compileall pass instead — say which in the profile. |
| `test_unit` | `pytest` | |
| `audit` | `pip-audit` | Reads the pinned requirements or the environment against the advisory database; unpinned dependencies make the result unrepeatable. |
| `secrets_scan` | gitleaks or trufflehog | Stack-neutral; the same choice as every other recipe. |
| `project_map` | project-owned generator | See below. |
| `design_limits` | pylint with `max-complexity`, or ruff's mccabe rules | The four bounds (complexity, length, parameters, nesting) are pylint configuration keys; calibrate on the real code before freezing. |
| `duplication` | the shipped `duplication.mjs`, or pylint's similarities check | The shipped scanner knows no language and works on any tree with real `roots`. |

`bandit` is the ecosystem's static security scanner: wire it behind an optional `sast` key rather than stretching `lint` to mean three different things.

## The project map

The map generator must parse Python, or it reads nothing. Two honest paths:

- a project-owned script using the standard library `ast` module — every public function and class with its docstring is one tree walk away;
- the shipped pattern generator `agent-pipeline/scripts/project-map.mjs` with `extensions: [".py"]` declared — it recognises `def` and `class` shapes and says on the map itself what it cannot see.

The trap to refuse is the empty map: a generator collecting zero files produces a document that `--check` compares empty to empty and passes. `map-coverage.mjs` is what separates an empty map from an up-to-date one. The full reasoning is in [the map section of the installation guide](../nouveau-profil.md#the-project-map-you-must-write-it-and-this-is-not-negotiable) and [the shipped generator's limits](../nouveau-profil.md#the-project-map-and-the-generator-the-framework-ships).

## What does not change

Attempt isolation (`git-worktree`), the CI template (the Python steps are the project's placeholder lines), and the tracker adapters are stack-neutral: configure them exactly as for any other stack.
