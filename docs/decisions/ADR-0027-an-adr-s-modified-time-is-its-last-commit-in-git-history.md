---
id: ADR-0027
title: An ADR's modified time is its last commit in git history, not its file mtime
status: proposed
origin: agent
date: 2026-11-20
tags: [api, ui]
components: [core, api]
code: [core:src/modified.ts]
review_rule: modifiedAt is the last commit that touched the file in this checkout (or on the default branch for ADRs only it holds), the file mtime only when this checkout changes the ADR or there is no default branch to read, and null when it cannot be known.
---

## Context

The API and the web app show when a decision last changed next to its revision. A checkout resets every file's mtime, so mtime says when the clone was made, not when the decision changed.

## Considered options

- File mtime for everything: cheap, but wrong after any clone or checkout.
- One `git log` per ADR: right, but slow on large logs.
- One `git log` per version of the log (working copy and base), dated by the last commit that touched each file.

## Decision

`modifiedAt` is the committer date of the newest commit in this checkout that touched the ADR's file, merge conflict resolutions included. An ADR that only the default branch holds (deleted here, or added upstream) takes that branch's last commit instead. It is the file's mtime when this checkout changes the ADR (uncommitted, or committed on the branch since it forked) or when there is no default branch to read: no git, a repo without a default branch, a log the repo ignores, a failed refresh. It is `null` when it cannot be known: a shallow clone (for committed and default-branch ADRs), an id used by several files, a file that vanished, or git unable to answer.

## Rationale

A commit date survives clones and says when the decision changed. A shallow clone would date everything by its boundary commit, so `null` is more honest than a wrong date. One `git log` per version keeps the list endpoint fast.

## Consequences

- Clients must handle `null` and show nothing.
- Dates move with the checkout: a branch behind `origin/main` shows its own history.
- A fresh clone of a feature branch dates that branch's ADRs at clone time, since this checkout changes them.
- Implemented in `packages/core/src/modified.ts`; documented in `docs/api.md`.
