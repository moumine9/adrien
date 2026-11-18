---
id: ADR-0022
title: packages/core is held to 100 percent test coverage
status: proposed
date: 2026-11-18
review_on: 2027-05-18
tags: [quality]
components: [core]
code: [core:src/**]
review_rule: CI fails when statements, branches, functions or lines in packages/core/src fall below 100 percent.
origin: agent
---

## Context

The core holds the format, the binding rules and every write. A defect there silently misleads agents, and the owner asked for 100 percent coverage of it.

## Considered options

- A coverage target below 100 percent.
- 100 percent of statements, branches, functions and lines on the core only.
- 100 percent everywhere.

## Decision

`packages/core/src` must stay at 100 percent for statements, branches, functions and lines. `vitest.config.ts` sets the thresholds, and CI runs `vitest run --coverage` on one cell (Ubuntu, Node 24). The CLI, MCP server, API and web app are thin layers and are tested without a threshold.

## Consequences

New core code ships with tests, and unreachable branches are removed instead of ignored. Coverage proves lines ran, not that assertions are meaningful, so it is a floor and reviews still judge the tests. Platform-specific branches are covered by the Windows cells passing, not by the coverage number.
