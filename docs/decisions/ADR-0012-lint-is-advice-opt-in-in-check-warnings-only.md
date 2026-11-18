---
id: ADR-0012
title: "Lint is advice: opt-in in check, warnings only"
status: proposed
date: 2026-11-18
tags: [workflow, format]
components: [cli, core]
code: [core:src/lint.ts, cli:src/commands/lint.ts]
review_rule: Lint findings are warnings and appear in check only with --lint; the markdownlint defaults turn off line length, duplicate headings and the H1 requirement.
origin: agent
---

## Context

Style advice helps people write readable ADRs, but a style rule that breaks a build gets the whole checker turned off. Existing logs also expect `check` to keep its current output.

## Considered options

- Run lint inside every check.
- Offer `adrien lint` and a `--lint` flag on check, with warnings only.

## Decision

`adrien lint` runs markdownlint with MADR-style settings plus three Adrien rules, and `adrien check --lint` includes the same findings. Nothing fails unless the team passes `--strict`.

## Rationale

It follows MADR's own stance that a linter should support the author and not annoy them, and it keeps `check` stable for everyone who does not ask for style advice.

## Consequences

People who never run lint never see the advice.
