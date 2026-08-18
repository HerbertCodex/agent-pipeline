---
name: design-patterns
description: Design a module when a concrete structural problem justifies a pattern (YAGNI/KISS first).
---

**Language note:** Examples use TypeScript with class-based OOP. Apply the same patterns using your project's language idioms — functional languages may use closures and modules instead of classes.

## Core principles (always apply)

- **Patterns are solutions to problems — not goals**: never apply a pattern
  without a concrete problem that justifies it (YAGNI, KISS)
- **Name the pattern**: once applied, name it in the code — `UserFactory`,
  `PaymentStrategy`, `OrderObserver` — it becomes living documentation
- **Favor composition over inheritance**: most patterns achieve flexibility
  through composition, not deep class hierarchies
- **If the code is simple and works — don't add a pattern**: complexity
  introduced without a clear benefit is always the wrong trade-off

## Warning signs that suggest a pattern

- Long `if/else` or `switch` that grows with every new type → **Strategy** or **Factory**
  _(Factory: the switch creates different objects. Strategy: the switch selects different behaviors at runtime.)_
- Creating objects with complex, multi-step setup → **Builder**
- A class doing too many unrelated things → **Facade** or **Decorator**
- Two incompatible interfaces that need to work together → **Adapter**
- One change triggers updates in many unrelated places → **Observer**
- Need to support undo/redo or queued operations → **Command**
- Need a single shared instance across the app → **Singleton**
  _(or use dependency injection / module-level exports — Singleton is rarely needed when DI is available)_

## When to load reference files

- Creating or instantiating objects (complex setup, multiple variants, shared instances)
  → read `references/creational.md`

- Composing classes or adapting interfaces (wrapping, adapting, simplifying)
  → read `references/structural.md`

- Defining how objects communicate or behave (events, algorithms, actions)
  → read `references/behavioral.md`

- Unsure which pattern applies to the current problem
  → read `references/when-to-use.md`

- Reviewing code for pattern misuse or missing patterns
  → read `assets/patterns-checklist.md`

## Gotchas

- Over-engineering is the most common mistake — a simple function often beats
  a Factory + Strategy + Observer chain
- Patterns add indirection — if the team isn't familiar with the pattern,
  a comment naming it is not optional, it's required
- Singleton is the most misused pattern — it's global state with a fancy name.
  Prefer dependency injection unless a single instance is a true system constraint
- Strategy and State look identical in code — the difference is intent:
  Strategy = interchangeable algorithms chosen by the caller,
  State = behavior that changes as the object's internal state changes

## Agent decision guide — before applying any pattern

An agent should default to the simplest code that works. Ask these three
questions in order. Only proceed to a pattern if the answer to #1 or #2
is "yes" and #3 is also true.

```
1. Is the current code already painful? (growing switch, duplicated
   construction logic, rigid coupling, hard to test)
2. Is a plain function / plain object / simple refactor unable to solve it?
3. Can you name the concrete problem the pattern solves, in one sentence?
```

If the answer is "I might need this later" — **do not apply the pattern**.
That's YAGNI. Apply it only when the pain exists now.
