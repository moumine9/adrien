---
id: ADR-0029
title: One component per file in the web app, with small private helpers kept beside their parent
status: accepted
date: 2026-11-22
review_on: 2027-05-22
tags: [ui]
components: [web]
code: [web:src/**]
review_rule: In packages/web/src outside components/ui, a React component over about 30 lines has its own file named after it in kebab-case (in views/ for a route, in components/ otherwise); a smaller component may share a file only with its single parent or with a family of small related components, as badges.tsx and states.tsx do.
origin: agent
---

## Context

Several views held many components in one file: the decision page had eight in 452 lines. Large files are slow to read, and a component buried in a view is hard to find, test or reuse.

## Considered options

- Keep components beside the view that uses them.
- One component per file, with no exception.
- One component per file, except small components that stay with their parent or with a family of related ones.

## Decision

In `packages/web/src`, outside `components/ui`, a React component over about 30 lines has its own file, named after it in kebab-case: in `views/` for a route, in `components/` otherwise. A smaller component may stay in the file of its only parent, or in a file that holds a family of small related components, as `badges.tsx` and `states.tsx` do. The components of the lazy-loaded decision and graph views are imported only by those views, so the first page does not grow.

## Rationale

A file per component is easy to find and to review, and a pull request that moves one shows a small diff. The exceptions avoid a file of ten lines for every small detail, and keep a family of small badges or states together. The 30-line threshold is one a reviewer can check without judgment.

## Consequences

More files, and imports to maintain. A component that grows past the threshold must move out. Moving components changes no behaviour, and the existing tests are the safety net.
