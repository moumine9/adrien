---
id: ADR-0038
title: A migration is written in the decision, with review_on as its end
status: proposed
date: 2026-11-27
tags: [workflow]
components: [mcp]
code: [mcp:src/tools.ts]
related: [ADR-0002, ADR-0016]
review_rule: Agents are told to apply a review_rule to the code they write or change, and no frontmatter key changes what binds over time.
origin: agent
---

## Context

A decision is often taken before the existing code follows it. Agents read accepted rules through adr_for_files before they edit a file.

## Decision

A migration is described in the decision's Consequences, with review_on as its end date. Agents are told to apply a review_rule to the code they write or change, and not to rewrite other code only to make it comply unless the user asks.

## Consequences

When review_on comes, review-due asks to confirm the migration is done or to supersede the decision; under check --strict that warning fails the check.
