---
id: ADR-0011
title: Keep MADR's RACI keys as written instead of mapping them to deciders
status: proposed
date: 2026-11-18
tags: [format]
components: [core]
code: [core:src/frontmatter.ts, core:src/model.ts]
review_rule: decision-makers, consulted and informed stay in the extra keys, verbatim and in their original order, when Adrien rewrites a file.
origin: agent
---

## Context

MADR 4 records who decided, who was consulted and who was informed under its own key names. Adrien has a `deciders` field of its own, but nothing reads it yet.

## Considered options

- Map the MADR keys onto `deciders` and new fields.
- Keep them untouched until something needs them.

## Decision

MADR's `decision-makers`, `consulted` and `informed` are preserved exactly as written and are not interpreted. A test pins that a rewrite keeps them.

## Rationale

Mapping would rename keys in people's files on every edit, which breaks the promise that ADRs stay plain files readable without Adrien, and it would serve no reader today.

## Consequences

A future interface that shows who decided has to read three keys instead of one.
