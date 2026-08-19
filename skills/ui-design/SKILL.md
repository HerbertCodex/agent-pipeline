---
name: ui-design
description: Design/build/review UI: layout, color, typography, animation. Distinctive brand, not a template.
applies_to: frontend, mobile, fullstack
---

## Craft — always applies, never varies by project

- **Mobile-first, always**: write styles for 320px first, enhance upward —
  never write desktop styles and override for mobile. No exceptions.
- **Every screen size works**: from 320px to 2560px — test at 375, 768, 1024, 1440, 1920
- **Generic is the enemy**: framework defaults are the baseline to escape, not the goal
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

## Direction — decided per project, and it must differ between them

Nothing below this line is settled by this skill. **Read `references/design-process.md`
first**: it takes the product to a brand brief, then to one named visual genre, then to
a constraint sheet. That sequence is the only thing standing between two of your projects
and the same interface.

> ⚠️ **If you skip it, every project you build converges.** Not on the framework default
> — this skill names those and refuses them — but on whatever this skill's own examples
> suggest. A guide read without a brief becomes a template, and the second cliché in
> `references/anti-generic.md` is exactly what that looks like: an interface recognisable
> as "an agent that read an anti-generic guide".
>
> The genre chosen in step 2 is written down and justified in one sentence. Two projects
> that land on the same genre must say why the same answer fits two different products —
> and usually it does not.

### What is already settled, and not by you

`design_system` in `pipeline.config.json` names the single source of truth for the
tokens and says whether the primitives are yours or a library's. `apply-profile` refuses
a project with screens that declares neither. **Read that block before proposing
anything** — a palette proposed against tokens that already exist is a second source of
truth, and two drift apart in silence.

### What you decide, in this order

1. **Brand personality** — one or two adjectives, from the product, not from taste
2. **Audience** — a fintech dashboard and a children's reading app share almost no decision
3. **One named visual genre**, with the sentence "this genre suits the brand because ___".
   If you cannot finish that sentence, the genre is wrong. It goes into
   `design_system.direction` in the configuration, and `apply-profile` refuses a
   project with screens that declares none — including the justification
4. **Light, dark, or both** — decided, never assumed. Dark by default is the tell

### What holds whatever the direction

- **Consistency over novelty**: one design system, applied everywhere
- **Hierarchy through contrast**: something dominates each screen. *Which* thing, and
  by how much, comes from the genre — a Swiss grid and an editorial page both have
  hierarchy and look nothing alike
- **Color as a tool, not decoration**: few colours, used on purpose
- **Intentional convention-breaking**: break rules on purpose, never by accident

## Animation direction

**Subtle micro-interactions** — not spectacle, but presence.
Every interaction should feel alive without drawing attention to itself.
The user should feel the quality, not see the animation.

**The vocabulary is a project decision, the restraint is not.** Pick two or three
gestures from the direction chosen in `design-process.md` and use only those. A
translate, a border, an underline, a fill, a scale, a glow — any of them works;
using all of them is what reads as machine-made.

```
✅ Right level — pick FEW, and the same ones everywhere:
- Hover: one property moves. Translate, or border, or fill — not three at once
- Press feedback: a small, fast acknowledgement (roughly 80–120ms)
- Focus: visible without hunting for it, and never the browser default alone
- Entrance: once, on arrival, then never again

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
