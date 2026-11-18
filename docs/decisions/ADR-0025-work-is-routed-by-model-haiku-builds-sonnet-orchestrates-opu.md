---
id: ADR-0025
title: "Work is routed by model: Haiku builds, Sonnet orchestrates, Opus has the last word"
status: proposed
date: 2026-11-18
review_on: 2027-05-18
tags: [agents, workflow]
components: [cli]
code: [cli:package.json]
review_rule: AGENTS.md names the three roles, and every pull request is reviewed by the sage tier before a merge is requested.
origin: agent
---

## Context

Agent tokens are the scarce resource. Using the strongest model for everything is slow and expensive, and using only the cheapest one lets design and security mistakes through. The owner asked for a tiered setup.

## Considered options

- One strong model for all work.
- One cheap model for all work.
- Tiers by difficulty: cheap workers on bounded tasks, a mid-tier orchestrator, and a strong model consulted for the last word.

## Decision

Haiku does bounded, well-specified work with a test to pass. Sonnet orchestrates: it plans, writes the specs, integrates, reruns the gates and opens pull requests. Opus is the sage: it reviews every pull request before a merge is requested, decides design and security questions, and settles disputes. Its verdict wins. A worker that fails twice escalates to the orchestrator, and Codex acts as an extra worker or reviewer whose output is verified like any other. A Haiku PR watcher, driven by a local script kept outside the repository, hands review comments to the orchestrator and implements the fixes the orchestrator specifies. It is the only agent that merges, and only for the maintainer's own, same-repository, non-draft pull requests, and only when the script reports that Codex approved exactly the head commit, the checks are green and the merge state is clean. The rules and the loop are in `AGENTS.md` and `CLAUDE.md`.

## Consequences

Cheap tokens do most of the typing and the expensive ones are spent on judgment, but quality depends on specs precise enough for a small model and on the orchestrator really verifying what workers report. A task that is mostly judgment, such as an ambiguous design, should skip the workers. The sage can be wrong too, so the person still approves merges and releases.
