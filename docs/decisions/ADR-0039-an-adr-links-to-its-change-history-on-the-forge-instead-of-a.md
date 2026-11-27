---
id: ADR-0039
title: An ADR links to its change history on the forge instead of Adrien reading git history
status: proposed
date: 2026-11-27
tags: [workflow]
components: [core, web]
code: [core:src/repo-url.ts, web:src/components/facts-panel.tsx]
related: [ADR-0002, ADR-0023, ADR-0027]
origin: agent
review_rule: "The API, the web and MCP never serve an ADR's past versions or commit messages; a history link is built only from a remote-tracking default branch and never carries the remote's user information."
---

## Context

Readers of an ADR want to see how it changed. Its versions live in the log repository's git history, on the forge that hosts it.

## Decision

Each ADR on the default branch links to its change history on the forge (a host named like GitHub or GitLab), built from the remote-tracking default branch and from a remote without its user information. The decision page shows the chain of decisions it replaced and that replaced it. The API, the web and MCP do not serve past versions or commit messages.

## Consequences

Other forges get no link. An ADR that is not on the remote-tracking default branch has no link.
