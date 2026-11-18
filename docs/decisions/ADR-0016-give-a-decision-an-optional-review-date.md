---
id: ADR-0016
title: Give a decision an optional review date
status: proposed
date: 2026-11-18
tags: [workflow]
components: [core]
code: [core:src/check.ts, core:src/model.ts]
review_rule: A live ADR whose review_on date has passed produces a review-due warning in check.
origin: agent
---

## Context

Decisions go stale and nobody remembers to look again. MADR notes when to revisit a decision, but only in free text that nothing can check.

## Considered options

- Leave it in the prose.
- Add a `review_on` date that check compares with today.

## Decision

An ADR may carry `review_on: YYYY-MM-DD`. Once that day arrives, `check` warns for any ADR that is not rejected, superseded or deprecated. A malformed date is refused before anything is written.

## Rationale

A date is cheap to add and is the one thing a tool can act on without understanding the decision.

## Consequences

A warning that is ignored stays a warning; teams that want a hard stop use `--strict`.
