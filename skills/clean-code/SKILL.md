---
name: clean-code
description: Naming, SOLID, DRY, KISS, docstrings for new code and reviews. Not for architecture or refactoring.
---

> **Language note:** Examples use JavaScript/TypeScript. Apply the same principles in your project's language, following its idioms and conventions.

## Quality standards (non-negotiable)

Every piece of code must meet these standards before delivery:

**Readability:**

- Every function, variable, and class has a name that explains its purpose
- No magic numbers or strings — use named constants
- No abbreviations except universally understood ones (id, url, api, db, etc.)
- Complex logic has comments explaining WHY, not WHAT

**Maintainability:**

- Every function does exactly one thing (Single Responsibility)
- Functions are short enough to understand without scrolling
- No deep nesting — use guard clauses and early returns
- Dependencies are injected, not hardcoded
- No dead code — remove unused functions, variables, and imports

**Performance awareness:**

- No O(n²) when O(n) or O(n log n) is possible — _unless the dataset is small and bounded, in which case the simpler code wins_
- No queries or I/O inside loops — batch or join instead
- No loading entire datasets when only a subset is needed
- No synchronous blocking in async code paths
- No unnecessary object creation in hot paths

**Error handling:**

- Every external call (DB, API, file system) has error handling
- Distinguish **expected** failures (not found, validation, auth) from **unexpected** failures (DB down, network error, bugs) — handle them differently
- Errors are typed/specific — no generic catch-all that swallows context
- Failed operations don't leave state partially modified
- User-facing errors are helpful; internal errors are logged with context

## Core principles (always apply)

These apply to every coding task, no reference file needed:

- **DRY**: extract duplicated logic into a single place
- **KISS**: simplest solution that works — resist over-engineering
- **YAGNI**: don't write code for hypothetical future needs
- **SRP**: each function/class has one reason to change
- **Low Coupling**: modules depend on each other as little as possible
- **High Cohesion**: things that change together, live together
- **Boy Scout Rule**: leave code cleaner than you found it

## When to load reference files

- Naming variables, functions, classes, or modules
  → read `references/naming.md`

- Writing, refactoring, or documenting functions and classes
  (includes docstrings / JSDoc / javadoc / XMLDoc)
  → read `references/functions.md`

- **Writing any function or class — always**
  → read `references/robustness.md`
  Covers: fail fast, guard clauses, defensive programming, null safety,
  no non-null assertions (`!`, `!!`, `.unwrap()`), structured error handling.
  Do not skip this even for "simple" functions — bad assumptions hide in simple code.

- Reviewing or designing module boundaries, dependencies, or abstractions
  → read `references/solid-and-coupling.md`

- Designing interfaces, APIs, or object interactions
  → read `references/interfaces.md`

- Doing a full code review
  → read `assets/review-checklist.md`

## Gotchas

- **YAGNI beats SOLID:** don't introduce abstractions "just in case". Apply SOLID principles when they solve a concrete problem — don't add abstractions preemptively. If you're unsure whether an abstraction is needed, it probably isn't yet.
- **Composition over Inheritance:** prefer assembling behaviors over class hierarchies
- **Avoid Premature Optimization:** never optimize before profiling proves it's needed
- **Design patterns are solutions to concrete problems, not goals in themselves —**
  applying one without a clear problem is a KISS and YAGNI violation
- **Docstrings should add information the signature doesn't already give —**
  don't document the obvious, document the non-obvious (edge cases, nulls, side effects)
- **No AI comment boilerplate:** do not leave `// End of function`, `// TODO: review later`,
  `// Main logic`, `// This function is now complete`, or section-divider comments.
  If a comment restates the code, delete it. If a block needs a label, extract it
  into a named function.
