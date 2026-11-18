---
id: ADR-0006
title: Inform and flag in review; never block
status: accepted
date: 2026-11-18
tags: [workflow]
components: [cli, core]
code: [core:src/check.ts]
review_rule: Style and staleness findings are warnings; only errors, or warnings under --strict, change the exit code.
deciders: [moumine9]
---

## Context

A tool that blocks merges for style or for a stale anchor gets switched off. The goal is that decisions are seen where code changes, not that pipelines break.

## Considered options

- Fail the pipeline on any finding.
- Report findings and fail only on real errors.

## Decision

`check` fails on errors such as duplicate ids and broken links. Stale anchors, style advice and review dates are warnings, and `--strict` turns warnings into failures for teams that want that.

## Rationale

People keep a checker they trust not to cry wolf, and `--strict` leaves the stricter choice with the team.

## Consequences

A warning can be ignored, so a team that cares has to opt in to `--strict`.
