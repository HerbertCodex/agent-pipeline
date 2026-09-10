# JVM recipe

A starting mapping of the mandatory gate keys to the usual Maven or Gradle toolchain. This is knowledge, not an adapter: the project-owned profile, its calibration on the real repository, and the negative proof of each gate remain mandatory, as [the installation guide](../nouveau-profil.md) prescribes. Commands below are given for Maven; the Gradle equivalents are `gradle compileJava`, `gradle build`, `gradle test`, `gradle spotbugsMain` and so on.

| Gate key | Usual command | Note |
| --- | --- | --- |
| `check` | `mvn compile` | The compiler is the type checker; keep `lint` out of it. |
| `lint` | Checkstyle or Spotless for form, SpotBugs or Error Prone for analysis | Form and analysis are separate plugins; both belong behind the key, wired into the build so CI runs the same thing. |
| `build` | `mvn package` | `mvn verify` when integration checks are bound to that phase. |
| `test_unit` | `mvn test` | Surefire for unit; keep Failsafe integration tests out of the fast lane. |
| `audit` | OWASP dependency-check (`dependency-check-maven`) | Reads the resolved dependency graph against the NVD; the first database fetch is slow, later runs are cached. |
| `secrets_scan` | gitleaks or trufflehog | Stack-neutral; the same choice as every other recipe. |
| `project_map` | project-owned generator | See below. |
| `design_limits` | PMD complexity rules for the four bounds, ArchUnit for architecture | ArchUnit carries what a threshold cannot: allowed dependency directions between packages, frozen as executable tests. |
| `duplication` | PMD CPD, or the shipped `duplication.mjs` | CPD is token-level and the usual choice on the JVM; the shipped scanner is the zero-install fallback. |

## The project map

The map generator must parse Java (or Kotlin), or it reads nothing. Two honest paths:

- a project-owned script using JavaParser or Spoon to walk `src/main/java` and emit every public type and method with its documentation;
- the shipped pattern generator `agent-pipeline/scripts/project-map.mjs` with `extensions: [".java", ".kt"]` declared — it recognises `public class` and method-shaped declarations and says on the map itself what it cannot see.

The trap to refuse is the empty map: a generator collecting zero files produces a document that `--check` compares empty to empty and passes. `map-coverage.mjs` is what separates an empty map from an up-to-date one. The full reasoning is in [the map section of the installation guide](../nouveau-profil.md#the-project-map-you-must-write-it-and-this-is-not-negotiable) and [the shipped generator's limits](../nouveau-profil.md#the-project-map-and-the-generator-the-framework-ships).

## What does not change

Attempt isolation (`git-worktree`), the CI template (the Maven or Gradle steps are the project's placeholder lines), and the tracker adapters are stack-neutral: configure them exactly as for any other stack.
