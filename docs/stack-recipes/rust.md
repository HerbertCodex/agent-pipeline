# Rust recipe

A starting mapping of the mandatory gate keys to the usual cargo toolchain. This is knowledge, not an adapter: the project-owned profile, its calibration on the real repository, and the negative proof of each gate remain mandatory, as [the installation guide](../nouveau-profil.md) prescribes.

| Gate key | Usual command | Note |
| --- | --- | --- |
| `check` | `cargo check` | Type checking without codegen; fast enough for the low lane. |
| `lint` | `cargo clippy -- -D warnings` and `cargo fmt --check` | Two tools, one key; the style half and the analysis half stay separate in the output. |
| `build` | `cargo build` | `cargo build --release` when the deliverable is the binary. |
| `test_unit` | `cargo test` | |
| `audit` | `cargo audit` | cargo-audit reads the lockfile against the advisory database; no lockfile, no audit. |
| `secrets_scan` | gitleaks or trufflehog | Stack-neutral; the same choice as every other recipe. |
| `project_map` | project-owned generator | See below. |
| `design_limits` | clippy thresholds | `clippy::cognitive_complexity`, `clippy::too_many_arguments`, `clippy::too_many_lines` carry three of the four bounds; nesting depth needs a project lint or an explicit invariant. |
| `duplication` | the shipped `duplication.mjs`, or jscpd | The shipped scanner knows no language and works on any tree with real `roots`. |

`cargo-geiger` complements `audit` for unsafe-code surface: it is a signal to display, not a refusal, so it belongs in the report or in an invariant, not behind a mandatory key.

## The project map

The map generator must parse Rust, or it reads nothing. Two honest paths:

- a project-owned script walking `src/**/*.rs` with `rust-analyzer` output or a small parser crate (`syn` handles items and doc attributes);
- the shipped pattern generator `agent-pipeline/scripts/project-map.mjs` with `extensions: [".rs"]` declared — it recognises `pub fn`, `pub struct`, `pub enum` shapes and says on the map itself what it cannot see.

The trap to refuse is the empty map: a generator collecting zero files produces a document that `--check` compares empty to empty and passes. `map-coverage.mjs` is what separates an empty map from an up-to-date one. The full reasoning is in [the map section of the installation guide](../nouveau-profil.md#the-project-map-you-must-write-it-and-this-is-not-negotiable) and [the shipped generator's limits](../nouveau-profil.md#the-project-map-and-the-generator-the-framework-ships).

## What does not change

Attempt isolation (`git-worktree`), the CI template (the cargo steps are the project's placeholder lines), and the tracker adapters are stack-neutral: configure them exactly as for any other stack.
