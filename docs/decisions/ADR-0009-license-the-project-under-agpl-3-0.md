---
id: ADR-0009
title: License the project under AGPL-3.0
status: accepted
date: 2026-11-18
tags: [release]
components: [cli]
code: [cli:package.json]
review_rule: LICENSE stays AGPL-3.0 and every published package declares AGPL-3.0-only.
deciders: [moumine9]
---

## Context

Adrien is meant to be used by teams and also run as a service. The licence decides whether changes to a service built on it have to stay open.

## Considered options

- A permissive licence such as MIT.
- The GNU AGPL, which also covers use over a network.

## Decision

The project is licensed under AGPL-3.0-only.

## Rationale

Anyone can use, change and self-host it, and a modified version offered over a network has to share its changes.

## Consequences

Some companies avoid AGPL code.
