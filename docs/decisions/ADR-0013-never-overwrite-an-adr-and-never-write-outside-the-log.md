---
id: ADR-0013
title: Never overwrite an ADR and never write outside the log
status: proposed
date: 2026-11-18
tags: [storage, agents]
components: [core, mcp]
code: [core:src/log.ts, core:src/ops.ts]
review_rule: New ADRs are written exclusively, every edit re-reads the file first, and a destination that resolves outside the log is refused.
origin: agent
---

## Context

Agents can call the tools in parallel, and a view of the log is loaded asynchronously, so it can be out of date by the time a write happens. A symlink or an id format with separators could also send a write outside the log.

## Considered options

- Trust the view that was loaded.
- Re-read from disk right before writing, write new files exclusively and check the final destination.

## Decision

Creating an ADR allocates its id from the files on disk and refuses to replace an existing file. Edits, accepts and renumbering re-read the target first. A destination is refused if it, or a folder above it, resolves outside the log.

## Rationale

The checks are small and synchronous, so nothing else in the same process can run between the read and the write, and a failed check leaves every file as it was.

## Consequences

Two separate processes can still allocate the same id in the same instant; `check` reports the duplicate and `renumber` fixes it.
