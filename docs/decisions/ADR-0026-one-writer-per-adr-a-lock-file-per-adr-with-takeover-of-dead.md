---
id: ADR-0026
title: "One writer per ADR: a lock file per ADR, with takeover of dead holders"
status: proposed
date: 2026-11-19
review_on: 2027-05-19
tags: [workflow, storage]
components: [core]
code: [core:src/lock.ts, core:src/ops.ts]
review_rule: Every command that changes an existing ADR holds that ADR's lock for the read, the change and the write, a change that names a revision is refused with ADR_CONFLICT when the ADR has changed since, and a lock is taken over only when its holder is gone or it is older than 30 seconds.
origin: agent
---

## Context

The CLI and the MCP server are separate processes, and an editor or git can change the same files. Each change reads an ADR, edits it and writes the whole file back, so two of them at once can overwrite each other without any error: the second write silently drops the first. The owner asked that the same ADR cannot be modified at once through the different ways of using the tool.

## Considered options

- Do nothing: the window is small, and a merge request catches mistakes.
- Check the file before writing and fail if it changed since it was read (optimistic concurrency, as git does when a push is rejected).
- One lock per ADR, taken by every command that changes it.
- One lock for the whole log.

## Decision

Every change to an existing ADR holds that ADR's lock for the read, the change and the write. A lock is a file under `.adrien/locks/`, created in one atomic step with its holder (pid, host, time) inside, so exactly one process gets it. Locks are taken in sorted order, so callers locking the same ADRs cannot deadlock, and are released even when the change fails. A waiter polls for up to 5 seconds (`ADRIEN_LOCK_TIMEOUT_MS`) and then fails with `ADR_LOCKED` without writing. A lock is taken over when its holder ran on this machine and is gone, or when it is older than 30 seconds; a lock from another machine is judged by age only. `supersede` locks both ADRs and `renumber` locks every ADR, since it can rewrite the ones that refer to the moved one. Creating an ADR keeps its own id reservation. **A change planned on an older read is refused, like a rejected push (the owner's request):** every read gives the ADR's `revision`, a short hash of the file, and a change that names it (`--expect` on `accept` and `status`, `base_revision` on the MCP tool `adr_propose_change`, which requires it) is applied only if the ADR still has that revision; otherwise it fails with `ADR_CONFLICT`, writes nothing and says to read the ADR again, redo the change on the latest version and retry. A command without a revision applies to the latest version.

## Consequences

Two writers can no longer lose each other's changes: a test with two processes making 50 changes to one ADR loses none, and loses 20 of them when the lock is switched off. The cost is a short wait, and an error to retry when a holder is slow. `renumber` is slower in a big log, which is acceptable for a rare command. Taking over a stale lock has a tiny window where two takers could both succeed; that needs a crashed holder and two simultaneous takers. The lock alone does not protect against a change made outside Adrien between the read and the write, such as an editor save; the revision check catches an editor save made after the read, and the merge request catches the rest. An agent must now read an ADR before it changes it, which is one more call. Locks live in one working copy, so two clones are reconciled by git as before.
