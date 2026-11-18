---
id: ADR-0001
title: Keep decisions as plain markdown files in git
status: accepted
date: 2026-11-18
tags: [format, storage]
components: [core]
code: [core:src/frontmatter.ts, core:src/log.ts]
review_rule: ADR content is read from and written to markdown files; the SQLite index can be rebuilt from them and holds nothing they lack.
deciders: [moumine9]
---

## Context

Decisions get lost when they live in a tool the team does not own. An ADR manager that stores them in its own database would add the same risk: if the tool goes away, so do the decisions.

## Considered options

- A database as the source of truth.
- Plain markdown files in git, with an index built from them.

## Decision

ADRs are markdown files with a little frontmatter, in a git repo the team already owns. Everything else, the search index included, is derived from those files.

## Rationale

Git already gives history, review and access control. Anyone can read the files without Adrien, and a rebuildable index can never disagree with them.

## Consequences

Search needs an index that is rebuilt from the files on demand. Workflow state that has no file, such as candidates found in chat, needs a store of its own later.
