# Skills

<!-- brief:implementer,qa,product,orchestrator -->
## A skill is advice, never a constraint

Skills are installed by `apply-profile` into the configured `skills_dir`, from `agent-pipeline/skills/` for what depends on no stack, and from `<profiles_dir>/<profile>/skills/` for what does. They are generated targets: `apply-profile --check` refuses an installed copy that has drifted from its source.

**Loading a skill is a choice, so a skill cannot carry a rule that matters.** The day an agent does not load it, the rule simply does not happen — nobody fails, nobody reports. A rule that matters becomes a command in `commands`. Otherwise it simply never applies.

Read a skill when the task is the one it names, and prefer the project's own gates when the two disagree: a gate is measured on this repository, a skill is general advice written elsewhere.
<!-- /brief -->

## Where a skill belongs

One question decides: **would this skill still be right in a project using another stack?**

If yes it belongs to `agent-pipeline/skills/` and travels with the framework. If no it belongs to the profile. `apply-profile` refuses the same name on both sides, so the ambiguity cannot survive silently.

**A third case exists, and it is not the same question.** A skill can depend on no stack and still be irrelevant to most projects: interface design applies to a browser or a phone, never to a service with no screen. Such a skill declares `applies_to: frontend, mobile, fullstack` in its frontmatter, and `apply-profile` leaves it out entirely where the declared `architecture.project_type` does not match — files and all, so `--check` does not report the absence as drift.

Without that, the only choices were a core wrong for a Go project, or a profile that a fresh project never receives. A name in `applies_to` that matches no known type is refused rather than ignored: a typo there would hide the skill on every project, and the failure would look exactly like the skill not existing.

A skill that names a tool as an *example* is not coupled, provided it says so and gives the transposition. The `tdd` skill uses one test framework in its examples and carries a map to six other languages: that is teaching, not coupling.

## What a skill must not do

- **Contradict a gate of the host profile.** A skill that suggests a shortcut a gate refuses sends the agent into a wall, and the agent will believe the skill.
- **Claim to enforce anything.** Only a command with an exit code enforces.
- **Grow into a second source of truth.** When a skill and a document disagree, the document wins; when a document and `rules.json` disagree, the rules file wins.
