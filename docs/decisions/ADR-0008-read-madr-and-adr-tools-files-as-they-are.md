---
id: ADR-0008
title: Read MADR and adr-tools files as they are
status: accepted
date: 2026-11-18
tags: [format]
components: [core]
code: [core:src/frontmatter.ts]
review_rule: Unknown frontmatter keys are kept verbatim and in their original order when Adrien rewrites a file.
deciders: [moumine9]
---

## Context

Teams already have ADRs in MADR, log4brains or adr-tools formats. Asking them to convert first would stop most from trying Adrien.

## Considered options

- Require Adrien's own format.
- Read the existing formats and keep what Adrien does not understand.

## Decision

Ids come from file names, titles from the first heading and the status from a Status section or bullet when the frontmatter lacks them. Keys Adrien does not know are preserved when it edits a file.

## Rationale

Adoption does not start with a migration, and a file never loses information because Adrien touched it.

## Consequences

Adrien still writes its own keys on files it creates, and MADR's RACI keys are not interpreted yet.
