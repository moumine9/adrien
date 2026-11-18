---
id: ADR-0004
title: Tags say what kind of concern; components say where it applies
status: accepted
date: 2026-11-18
tags: [format]
components: [core]
code: [core:src/check.ts, core:src/config.ts]
review_rule: Tags and components are separate frontmatter fields, and each is checked against the product's own list in the config.
deciders: [moumine9]
---

## Context

Teams want to find decisions by topic, such as security or database, and by the part of the system they affect. One field cannot do both without becoming a mix of the two.

## Considered options

- A single labels field.
- Tags for the kind of concern and components for the place, each with its own list.

## Decision

Each product lists its tags and its components in the config. An ADR uses tags for the concern and components, with optional `component:glob` anchors, for the code it governs.

## Rationale

Separate fields keep the lists short and meaningful, and let `adrien for` answer by location while search answers by topic. Unknown values fail `check`, so the vocabulary does not drift.

## Consequences

A new tag or component is a config change before it can be used.
