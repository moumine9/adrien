---
id: ADR-0014
title: Compare canonical paths wherever git and node meet
status: proposed
date: 2026-11-18
tags: [storage]
components: [core]
code: [core:src/paths.ts, core:src/git.ts]
review_rule: Paths that come from git and paths that come from node are compared only after canonicalPath has resolved symlinks, short names and drive-letter case.
origin: agent
---

## Context

Git reports physical paths. Node sees whatever path it was given: a symlinked checkout, or on Windows an 8.3 short name such as RUNNER~1. Comparing the two as strings made the default branch look empty, so every ADR looked pending.

## Considered options

- Compare the strings as they come.
- Resolve both sides to the real path first.

## Decision

`canonicalPath` resolves a path with the operating system's real-path call. It is applied to git's top-level path, to the working directory and to the log root.

## Rationale

It fixes a class of bugs at the one place paths are compared, and the same code is right on Linux, macOS and Windows.

## Consequences

Paths in messages show the real location, not the one the user typed.
