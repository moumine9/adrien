---
id: ADR-0018
title: Adrien keeps its own decision log and owns its formatting
status: proposed
date: 2026-11-18
tags: [workflow]
components: [cli]
code: [cli:src/commands/check.ts]
review_rule: CI runs adrien check --lint --strict on docs/decisions without --mr, and Biome and markdownlint-cli2 leave that folder alone.
origin: agent
---

## Context

A decision tool whose own decisions live elsewhere would not be believed. The files are written by Adrien's serializer, which a general Markdown formatter would re-flow.

## Considered options

- Record the project's decisions in a wiki.
- Keep them in the repo, checked by the tool itself.

## Decision

The repository has its own `adrien.config.yaml` and `docs/decisions`. CI builds the CLI and runs `check --lint --strict` on it. Biome and markdownlint-cli2 ignore the folder.

## Rationale

It tests the tool on a real log in every build, and a shallow CI checkout may lack the default branch, so `--mr` is not used.

## Consequences

Two formatters are told to skip a folder, so its style is only as good as Adrien's lint.
