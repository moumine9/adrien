---
id: ADR-0036
title: adr_for_files lists the decisions anchored elsewhere in a file's component
status: proposed
date: 2026-11-24
tags: [agents, api]
components: [core, cli, mcp, api, web]
code:
  - core:src/for-files.ts
  - cli:src/output.ts
  - mcp:src/tools.ts
  - api:src/contract.ts
  - web:src/components/file-result.tsx
review_rule: A file's nearby list holds only accepted decisions of its component whose anchors match other paths, at most ten with a count of the rest, never binding and without their review rule, and nothing shows a nearby entry as governing the file.
related: [ADR-0002, ADR-0034, ADR-0035]
origin: agent
---

## Context

`adrien for`, the `adr_for_files` MCP tool and `GET /api/for` return, for each file, the decisions whose anchors or components cover it. An empty answer looks the same whether no decision concerns the file or a decision that should concern it is anchored to a neighbouring path: a decision anchored to `billing-service:src/Invoices/**` says nothing about a new `src/Importers/InvoiceImporter.ts` in the same component. An agent reads an empty list as permission. Widening every anchor is no answer either: each widened anchor adds a binding rule to every file it reaches, and a long list of rules gets skimmed.

## Considered options

- Leave the answer as it is and rely on people writing wide anchors.
- Add the decisions anchored elsewhere to `decisions`, with a new `match` value.
- A separate list per file, `nearby`, of the decisions anchored elsewhere in the same component, with their titles and anchors only.

## Decision

Each file gets a `nearby` list beside `decisions`, always present, empty for a file outside every component. It holds the accepted decisions on the default branch, of the product's log and of its common log (ADR-0034), that have at least one anchor in the file's component, none of which matches the file. Each entry carries `id`, `title`, `workspace` and the decision's anchors in that component; never `binding`, never the review rule. Left out: a decision already listed in `decisions` for that file in any layer, and a common decision that an accepted exception of the product exempts for that file (ADR-0035).

The list is ordered by how many leading directories an anchor's fixed part shares with the file's path, closest first, then by id, and holds at most ten entries; `nearby_omitted` counts the ones left out. The merge request comment that `adrien review` writes does not show it: it speaks to reviewers about the decisions that govern the change. Its `--json` output carries the files as `adrien for --json` does, `nearby` included.

## Rationale

A separate list keeps `decisions` meaning what governs the file, so nothing that reads it today changes meaning, and ADR-0002 still holds: only what is listed in `decisions` can bind. Titles without rules let an agent judge relevance (an invoice importer next to "Store invoices in Postgres") without being handed more rules to follow. Ordering by directory proximity puts the decisions of the neighbouring folders first in a large component, and the cap with a count keeps the answer short without hiding that more exist.

## Consequences

The answer of `adr_for_files`, `adrien for --json` and `GET /api/for` gains two fields, `nearby` and `nearby_omitted`, on every file. `adrien for` prints the nearby decisions under a file and says when no decision covers it; the web visualizer shows them apart from the governing ones. In a component whose decisions are anchored to single files, every file lists most of them, which is the cost of not hiding a decision that should apply. An agent that finds a nearby decision which should govern the file follows it and tells the person that its anchors need widening; Adrien never widens an anchor by itself.
