---
name: refactoring
description: Improve existing working code with smells. Not for new features - use tdd.
---

> **Note:** Examples use TypeScript. Apply the same refactoring principles in your project's language.

## Core principles (always apply)

- **Tests before refactoring**: have tests covering the code you're refactoring.
  Safe refactorings that change no behavior and are fully caught by the compiler or IDE
  (renames, simple extractions, moving a clearly-used function) may not need new tests.
  Anything that changes control flow, data structures, or side effects requires tests first.
  When tests don't exist, write characterization tests to capture current behavior before touching the code.
- **One transformation at a time**: make one logical change at a time —
  related changes (e.g., rename + extract in the same function) can be combined if the intent is clear
- **Don't change behavior**: refactoring is structural improvement only —
  if behavior changes, it's not refactoring, it's a bug or a feature
- **Stop when clean**: don't over-engineer — stop when the code
  communicates its intent clearly
- **Boy Scout Rule**: leave code cleaner than you found it —
  even small improvements compound over time. The Boy Scout Rule means making
  small improvements as you pass through code — it does not mean stopping to
  redesign an area you're only touching briefly

## Warning signs that refactoring is needed

- Function longer than ~20 lines or class longer than ~200 lines
- A name that requires a comment to explain what it does
- The same logic copy-pasted in two or more places
- A function that needs to know too much about another object
- Deep nesting (more than 2-3 levels of if/for)
- A change in one place requires changes in many unrelated places
- You hesitate to touch a piece of code because you don't understand it

## When to load reference files

- Identifying what is wrong with existing code
  → read `references/code-smells.md`

- Knowing which transformation to apply
  → read `references/techniques.md`

- Deciding when to refactor and how to manage the process safely
  → read `references/when-to-refactor.md`

- Ensuring the refactoring process is safe and controlled
  → read `references/safe-process.md`

- Reviewing a refactoring for completeness and safety
  → read `assets/refactoring-checklist.md`

## Gotchas

- Refactoring without tests is rewriting — you have no proof behavior is preserved
- Renaming is the most impactful and safest refactoring — do it freely
  in statically typed languages or with IDE support — in dynamic languages, verify no string-based references exist
- Premature refactoring is as harmful as none — don't refactor code
  that won't be touched again (YAGNI)
- "Clean" is not the same as "clever" — a refactored function should be
  easier to understand, not more elegant in an abstract sense
- Large refactorings done in one step are risky — break them into
  a sequence of small, independently safe steps
