---
id: ADR-0028
title: Name repeated styling as reusable CSS classes instead of long className chains
status: accepted
date: 2026-11-22
review_on: 2027-05-22
tags: [ui]
components: [web]
code: [web:src/**]
review_rule: In packages/web/src outside components/ui, a visual style repeated across elements (a frame, a surface, a banner) is a named @utility in index.css, and a className adds only what is specific to that element - layout, colour, size, variants.
origin: agent
---

## Context

Tailwind utilities written inline made some `className` strings very long, and the same group of utilities (the rounded, outlined frame, with or without a background) was copied into about twenty places. A change to the frame meant finding every copy, and a long chain hides what the element is for.

## Considered options

- Keep utilities inline, and accept the repetition.
- Extract a React component for each repeated shape.
- Name each repeated group as a custom utility with `@utility` in `index.css`, applied by its class name.

## Decision

In `packages/web/src`, outside `components/ui`, a visual style repeated across elements (a frame, a surface, a banner) is a named `@utility` in `index.css`; the first three are `frame`, `panel` and `notice`, introduced in #46. A `className` then adds only what is specific to that element: layout, colour, size and variants. Layout utilities such as `flex items-center gap-2` stay inline. The vendored neobrutalism.dev components in `components/ui` stay as upstream wrote them, so they remain easy to update.

A component is still the right tool when the repeated thing has structure or behaviour, as `DecisionSurface` does with its band, notch and edge. The class is for repeated styling only.

## Rationale

One name states the intent, and one definition changes the look everywhere. The same frame sits on different elements (`p`, `section`, `details`, `dd`, `button`, `span`): a class works on any of them, where a component would need an `as` prop at every use. It also lets a test keep the raw chain out of the code, which `lib/frame-classes.test.ts` does for the frame.

## Consequences

A reader opens `index.css` to see what a class contains, and the classes need names that say what they are for. Tailwind-merge in `cn()` cannot see inside a custom class, so a call that mixes one with a conflicting utility must be checked by hand. A group used once stays inline.
