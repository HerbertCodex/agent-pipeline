---
name: tdd
description: New code or bug fixes: failing test first, then pass, then refactor. Not for cleanup of tested code.
---

> **Language-agnostic**: Examples use Jest and TypeScript. Apply the same TDD
> principles with your project's test framework and language. See
> `references/language-transposition.md` for common equivalents.

## When to use this skill

- Adding a new function, method, class, module, or endpoint.
- Changing existing behavior (including bug fixes).
- Refactoring untested code that you must touch to add behavior.

## When strict test-first may be relaxed

- **Spikes and proofs of concept**: you may write exploratory code first to learn,
  but the spike must be rewritten with tests before it is delivered.
- **Pure framework wiring** with no conditional logic (e.g. a one-line re-export)
  does not need its own test — but any behavior built on top of it does.
- **Trivial data classes / structs** without logic are tested through the code
  that uses them, not with isolated getter tests.

Default rule: if you are unsure, write the test first.

## Core principles

- **Test behavior, not units of code**: a failing test describes an observable
  behavior from the caller's perspective. New behavior is the trigger for a new
  test, not the existence of a new function.
- **Red before Green**: write one failing test, then the minimum code to pass it.
- **One failing test at a time**: keep the feedback loop tight.
- **Refactor only under green**: clean up after tests pass, not during Red or
  mid-Green.
- **Tests are specifications**: a test suite should say what the code does and
  under which conditions.

## The cycle

1. 🔴 **Red** — write a test that describes one desired behavior. Run it. It must
   fail. If it passes immediately, either the behavior already exists or the test
   is not exercising it.
2. 🟢 **Green** — write the minimum code to make the test pass. No cleanup. No
   additional behavior.
3. 🔵 **Refactor** — improve the code without changing behavior. Run tests after
   every change.

Repeat for every new behavior.

## Working with existing untested code

When you must change code that has no tests:

1. **Protect the existing behavior first** — add a characterization test that
   documents the current output for the relevant inputs. It may pass; that is
   fine. Its job is to detect regressions.
2. **Write a failing test for the new behavior** — this is your Red step.
3. **Implement the change.**
4. **Keep the characterization test** unless it documents a bug you are
   intentionally fixing.

Do not use "the code already works" as an excuse to skip tests for new behavior.

## Test scope rule

- **New behavior** → at least one failing test before implementation.
- **Bug fix** → at least one regression test that reproduces the bug before the
  fix.
- **Refactoring already-tested code** → tests should already exist; if not, add
  characterization tests first.
- **Pure framework glue / trivial delegation** → no dedicated test needed, but it
  must be exercised by tests of real behavior.

## When to load reference files

- Detailed Red/Green/Refactor cycle with examples
  → read `references/cycle.md`

- Writing, naming, and structuring tests (AAA, what to test, what not to test)
  → read `references/writing-tests.md`

- When and how to use mocks, stubs, or spies
  → read `references/mocking.md`

- Choosing between unit, integration, or e2e tests
  → read `references/test-types.md`

- Mapping TDD concepts to other languages and frameworks
  → read `references/language-transposition.md`

- Full test review
  → read `assets/test-checklist.md`

## Common mistakes

- Writing implementation code before a failing test exists.
- Refactoring while a test is red or before all tests pass.
- Skipping the "verify it fails" step — a test that never fails is not testing
  anything.
- Testing internal structure instead of observable outcomes.
- Testing trivial getters or framework plumbing.
- Using "one assertion per test" as a strict rule. The real rule is: one
  _concept_ per test. Multiple assertions are fine if they verify one outcome.
- Treating hard-to-test code as a reason to skip tests. Hard-to-test code is a
  design signal: reduce coupling, inject dependencies, or split responsibilities.

## Quality gate

No new behavior or bug fix is considered complete until the new tests pass and
existing tests remain green.
