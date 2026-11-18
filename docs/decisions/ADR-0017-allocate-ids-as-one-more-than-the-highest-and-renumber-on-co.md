---
id: ADR-0017
title: Allocate ids as one more than the highest and renumber on collision
status: proposed
date: 2026-11-18
tags: [format, workflow]
components: [core]
code: [core:src/ids.ts, core:src/ops.ts]
review_rule: A new id is one more than the highest id on the default branch and in the working tree; check fails on duplicate ids and renumber resolves them.
origin: agent
---

## Context

Sequential ids are easy to read and to cite, but two branches can pick the same number at the same time.

## Considered options

- Random or time-based ids.
- Sequential ids with a collision check and a renumber command.

## Decision

Ids follow the product's `id_format`, such as `ADR-{n:4}`. `new` takes the next number after the highest one it can see, `check` reports a duplicate, and `renumber` gives the newer ADR the next free id and updates the references in other pending ADRs.

## Rationale

People refer to decisions by number, and a collision is rare, visible and cheap to fix.

## Consequences

A server later has to reserve numbers to avoid collisions between branches altogether.
