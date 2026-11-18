---
id: ADR-0003
title: AI agents propose decisions but never accept them
status: accepted
date: 2026-11-18
tags: [agents, workflow]
components: [mcp, core]
code: [mcp:src/tools.ts, core:src/ops.ts]
review_rule: No MCP tool input accepts status or origin, and everything an agent writes is proposed with origin agent.
deciders: [moumine9]
---

## Context

Agents can notice decisions and edit ADRs, which is useful. If they could also accept them, the record would stop being a statement the team agreed to.

## Considered options

- Let agents set any status.
- Let agents write only proposed ADRs and pending edits.

## Decision

The MCP tools can create a proposed ADR and edit an existing one in the working copy. Their schemas have no status or origin, and a status inside an edit is rejected.

## Rationale

The tool schema is the one place an agent cannot argue its way around. A person accepts by merging the merge request.

## Consequences

Every agent proposal needs a human to review and merge it, which is the point.
