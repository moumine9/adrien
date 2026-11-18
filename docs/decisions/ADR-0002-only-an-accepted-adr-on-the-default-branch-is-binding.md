---
id: ADR-0002
title: Only an accepted ADR on the default branch is binding
status: accepted
date: 2026-11-18
tags: [workflow]
components: [core]
code: [core:src/view.ts, core:src/for-files.ts]
review_rule: Anything that differs from the default branch is reported as pending and is never marked binding, whatever its status field says.
deciders: [moumine9]
---

## Context

An ADR file can say `status: accepted` on any branch, including one nobody has reviewed. If that were enough to bind, an agent or a hurried edit could make its own change authoritative.

## Considered options

- Trust the status field wherever the file is.
- Bind only what is accepted on the default branch, and show everything else as pending.

## Decision

The version on the default branch is the binding one. Changes in the working tree or on the current branch are returned as pending, labelled, and never binding.

## Rationale

Merging is already the approval step teams use for code. Tying binding to the default branch reuses it, with code owners and required approvals, instead of inventing a second approval system.

## Consequences

Outside a git repo, or when no default branch can be found, statuses are read as written. `check --mr` reports an unresolved default branch as an error.
