---
id: ADR-0025
title: "Work is routed by model: Haiku builds, Sonnet orchestrates, Opus has the last word"
status: proposed
date: 2026-11-18
review_on: 2027-05-18
tags: [agents, workflow]
components: [cli]
code: [cli:package.json]
review_rule: AGENTS.md names the three roles, nothing is pushed or opened as a pull request before the sage tier has finished reviewing it, every fix pushed in answer to Codex is reviewed by the sage first, and a merge is pinned to the head commit Codex approved.
origin: agent
---

## Context

Agent tokens are the scarce resource. Using the strongest model for everything is slow and expensive, and using only the cheapest one lets design and security mistakes through. The owner asked for a tiered setup.

## Considered options

- One strong model for all work.
- One cheap model for all work.
- Tiers by difficulty: cheap workers on bounded tasks, a mid-tier orchestrator, and a strong model consulted for the last word.

## Decision

Haiku does bounded, well-specified work with a test to pass. Sonnet orchestrates: it plans, writes the specs, integrates, reruns the gates and opens pull requests. Opus is the sage: it reviews every change before it is pushed or a pull request is opened, and every fix made in answer to Codex before that fix is pushed (the owner's rule of 2026-11-19), decides design and security questions, and settles disputes. Its verdict wins. A worker that fails twice escalates to the orchestrator, and Codex acts as an extra worker or reviewer whose output is verified like any other. A Haiku PR watcher, driven by a local script kept outside the repository, hands review comments to the orchestrator and implements the fixes the orchestrator specifies. **The owner's merge rule (stated on 2026-11-19: "codex approved, so you can merge"):** Codex's approval of the exact head commit, with green checks and a clean merge state, is the owner's go-ahead to merge. The script reports that state as `ready` for the maintainer's own, same-repository, non-draft pull requests, and a merge is always pinned to the approved commit (`gh pr merge --match-head-commit <sha>`). The owner's permission classifier has refused every merge that a subagent decided on its own (#15 and #17), so the watcher watches and reports, and the orchestrator merges in the state the owner named; a merge the classifier refuses is never worked around. The rules and the loop are in `AGENTS.md` and `CLAUDE.md`.

## Consequences

Cheap tokens do most of the typing and the expensive ones are spent on judgment, but quality depends on specs precise enough for a small model and on the orchestrator really verifying what workers report. A task that is mostly judgment, such as an ambiguous design, should skip the workers. The sage can be wrong too, and Codex can miss things, so the pinned commit and the green checks stay in the loop; tags and releases remain the owner's word. The costs are that merging is done by the orchestrator, in the state the owner named, which is slower than a fully automatic watcher, and that the sage reads each fix before it is pushed, which adds a round to every Codex comment.
