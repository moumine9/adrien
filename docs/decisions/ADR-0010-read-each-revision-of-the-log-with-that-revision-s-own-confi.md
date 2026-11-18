---
id: ADR-0010
title: Read each revision of the log with that revision's own config
status: proposed
date: 2026-11-18
tags: [workflow, format]
components: [core]
code: [core:src/view.ts, core:src/config.ts]
review_rule: The default branch's ADRs are parsed with the config found at that revision, never with the working tree's config.
origin: agent
---

## Context

A branch can move the ADR directory or change the id format. If the default branch were read with the branch's config, it would look for its files in a folder that does not exist there, and every decision it holds would vanish from the binding view.

## Considered options

- Read every revision with the working tree's config.
- Read each revision with the config committed at that revision.

## Decision

The base and the fork point are each read with the `adrien.config.yaml` found at that revision. When a revision has no config, or an invalid one, the working config is used.

## Rationale

A pending change to the config is a proposal like any other, so it must not change what the default branch means.

## Consequences

Each revision costs one extra `git show`. A branch that moves the log shows its files as modified, not as added.
