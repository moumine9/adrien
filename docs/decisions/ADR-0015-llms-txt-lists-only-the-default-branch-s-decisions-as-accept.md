---
id: ADR-0015
title: llms.txt lists only the default branch's decisions as accepted
status: proposed
date: 2026-11-18
tags: [workflow, agents]
components: [core, cli]
code: [core:src/export.ts]
review_rule: The accepted section of an export comes from the default branch; an edit made in the checkout is listed as pending.
origin: agent
---

## Context

An llms.txt tells a model what to follow. If it were built from the working files, editing an accepted rule on a branch would instruct models to follow the new rule before anyone approved it, while `adrien for` correctly keeps the old rule binding.

## Considered options

- Group the working files by their status field.
- Take accepted decisions from the default branch and list edits separately.

## Decision

`adrien export --format llms` writes the default branch's accepted ADRs under Accepted, its proposed ones under Proposed, and every difference in the checkout under Pending, with its kind.

## Rationale

The export must agree with `adrien for` about what is binding.

## Consequences

A moved file can be linked at its old path until the move is merged.
