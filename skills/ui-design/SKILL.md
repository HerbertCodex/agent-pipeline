---
name: ui-design
description: Design/build/review UI: layout, color, typography, animation. Distinctive brand, not a template.
applies_to: frontend, mobile, fullstack
---

## Core principles (always apply)

- **Mobile-first, always**: write styles for 320px first, enhance upward —
  never write desktop styles and override for mobile. No exceptions.
- **Every screen size works**: from 320px to 2560px — test at 375, 768, 1024, 1440, 1920
- **Generic is the enemy**: default Tailwind blue, Inter font, white background,
  card grid layouts — these are the baseline to escape, not the goal
- **First impression is everything**: every screen must have one element
  that makes someone stop and look — a color, a type treatment, a motion
- **Personality before polish**: a strong visual identity with rough edges
  beats a perfectly polished but forgettable interface
- **Motion has meaning**: every animation communicates something —
  never add motion for its own sake, never skip it when it would add clarity
- **Accessibility is the part that can be measured**: contrast ratio, focus order,
  keyboard reachability, and what a screen reader announces. Everything else on this
  page is judgement, and judgement is argued. These are numbers, and numbers are
  checked — `commands.accessibility` is what checks them, and it fails like any other
- **Constraints create creativity**: pick a tight design system and push it
  hard rather than using every option available

## Visual direction

The visual direction is **defined by the project**, not by this skill.

**The structural half of it is already settled**, and not here: `design_system` in
`pipeline.config.json` names the single source of truth for the tokens and says whether
the primitives are yours or a library's. `apply-profile` refuses a project with screens
that declares neither. Read that block before proposing anything — a palette proposed
against tokens that already exist is a second source of truth, and two drift apart in
silence.

What this skill decides is what the tokens should CONTAIN:

1. **What is the brand personality?** — playful, corporate, technical, luxury, minimal?
2. **What are the brand colors?** — if none exist, propose a palette and get approval
3. **What is the target audience?** — this drives every visual decision
4. **Light mode, dark mode, or both?** — decide upfront, don't assume

Once defined, apply these universal principles:

- **Consistency over novelty**: one design system, applied everywhere
- **Hierarchy through contrast**: one bold element per screen, generous whitespace
- **Color as a tool, not decoration**: accent colors used sparingly and with purpose
- **Intentional convention-breaking**: break rules on purpose, never by accident

## Animation direction

**Subtle micro-interactions** — not spectacle, but presence.
Every interaction should feel alive without drawing attention to itself.
The user should feel the quality, not see the animation.

```
✅ Right level:
- Hover states that shift slightly — translate, glow, border fade
- Button press feedback — scale(0.97), 100ms
- Focus rings with glow instead of default outline
- Text that fades in on scroll — once, cleanly, done
- Input borders that light up on focus

❌ Too much:
- Scroll-hijacking or pinned horizontal scroll
- Particles, complex 3D, full-page transitions
- Anything that delays the user getting to the content
- Animations that loop indefinitely and distract
```

## Warning signs of generic UI

- Using framework default colors without customization (e.g. Tailwind blue #3B82F6)
- Inter or system-ui as the only font with no display font
- Every section is a centered container with a card grid
- Buttons are rounded rectangles with no personality
- Hover states are just opacity changes
- Animations are `transition-all duration-200` on everything
- No visual identity — could belong to any company

## When to load reference files

- **Starting any UI task — always read this first**
  → read `references/design-process.md`
  Covers: brand brief, reference gathering (moodboard), constraint setting,
  layout language, and the "one memorable thing" decision — all before any CSS.
  Do not skip this even for "small" UI tasks — defaults hide in small decisions.

- Applying UX laws (Fitts, Hick, Miller, Jakob, Peak-End, Von Restorff, Zeigarnik, Postel)
  → read `references/ux-laws.md`

- Applying UX patterns (feedback, forms, errors, empty states, mobile, micro-copy)
  → read `references/ux-patterns.md`

- Organizing CSS, choosing between raw CSS / Tailwind / UnoCSS, or writing
  scoped styles in Svelte / Vue / Angular / React
  → read `references/css-architecture.md`

- Defining the visual identity, typography, or color palette
  → read `references/visual-identity.md`

- Designing layout, composition, or page structure
  → read `references/layout.md`

- Adding animations, transitions, or micro-interactions
  → read `references/motion.md`

- Designing specific UI components (buttons, forms, cards, nav)
  → read `references/components.md`

- Reviewing UI that looks too generic or template-like
  → read `references/anti-generic.md`

- Implementing dark/light mode, theming system, or mode toggle
  → read `references/theming.md`

- Ensuring the UI loads fast, doesn't shift, and responds instantly
  → read `references/performance.md`

- Full UI review
  → read `assets/design-checklist.md`

## Gotchas

- **Both modes are required**: every UI must work in dark AND light mode —
  never build one without the other
- **Mobile-first means `min-width`, never `max-width`** — writing desktop first
  and overriding for mobile creates specificity conflicts and unmaintainable code
- **Test at 320px first, and at 2560px too.** 320px working proves the layout does
  not overflow; it proves nothing about what a wide screen does with the space.
  The two ends fail differently, and only the narrow one is commonly checked
- Tailwind's default config is a constraint to override, not a design system —
  always extend it with custom colors, fonts, and spacing
- `shadcn/ui` and similar component libraries produce identical-looking apps —
  use them only as a base and restyle aggressively
- Accessibility and visual boldness are not opposites — high contrast ratios
  work with bold design, not against it
- Never use more than 2 typefaces — one display font + one text font is enough
- A dark theme is not just `background: black; color: white` —
  it requires rethinking every elevation, border, and shadow
- "Experimental" does not mean chaotic — every unconventional choice
  must have a reason. Break rules on purpose, not by accident
- Subtle animations are harder than complex ones — a 200ms hover transition
  that feels perfect takes more iteration than a scroll-driven timeline
- Stack-agnostic means: CSS and design tokens first, JS animations second.
  The core visual identity must work without JavaScript.
