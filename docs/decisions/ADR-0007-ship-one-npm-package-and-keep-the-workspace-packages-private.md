---
id: ADR-0007
title: Ship one npm package and keep the workspace packages private
status: accepted
date: 2026-11-18
tags: [release]
components: [cli]
code: [cli:package.json, cli:tsdown.config.ts]
review_rule: Only the adrien package is published; @adrien/core and @adrien/mcp are private and bundled into it.
deciders: [moumine9]
---

## Context

The code is split into a core library, an MCP server and a CLI, but users want to run one command.

## Considered options

- Publish every package.
- Publish the CLI as one package that bundles the others.

## Decision

`adrien` is the only published package. It bundles @adrien/core and @adrien/mcp, and lists only third-party runtime dependencies.

## Rationale

One name to install and version, and the internal boundaries can change freely.

## Consequences

A dependency of a bundled package must also be listed in the CLI's manifest, or a clean install will miss it.
