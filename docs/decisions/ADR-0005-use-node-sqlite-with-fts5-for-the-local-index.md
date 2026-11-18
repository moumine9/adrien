---
id: ADR-0005
title: Use node:sqlite with FTS5 for the local index
status: accepted
date: 2026-11-18
tags: [storage]
components: [core]
code: [core:src/index-db.ts, core:src/sqlite.ts]
review_rule: The index uses node:sqlite and needs no native build; the minimum Node version stays at 22.13.
deciders: [moumine9]
---

## Context

Search over hundreds of ADRs should be fast and accent-insensitive, and `npx adrien` should work without compiling anything.

## Considered options

- A native SQLite binding.
- A pure JavaScript search library.
- The SQLite built into Node, with FTS5.

## Decision

The index is a SQLite database opened through node:sqlite, with an FTS5 table for search, stored in a git-ignored folder next to the log and synchronised from the files by hash.

## Rationale

It adds no dependency and no install step, and FTS5 gives ranked, diacritic-insensitive search.

## Consequences

Node 22.13 or later is required, and the module is still marked experimental, so its warning is silenced.
