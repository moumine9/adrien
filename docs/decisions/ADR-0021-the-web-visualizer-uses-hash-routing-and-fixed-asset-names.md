---
id: ADR-0021
title: The web visualizer uses hash routing and fixed asset names
status: proposed
date: 2026-11-18
review_on: 2027-05-18
tags: [ui]
components: [web, api]
code: [web:vite.config.ts, api:src/web.ts]
review_rule: Routes live in the URL hash, assets keep fixed names, and every static response is sent with Cache-Control no-cache.
origin: agent
---

## Context

The app is served by `adrien serve` from whatever directory the bundle was extracted to, and the same files may be opened behind a path prefix or through a dev proxy. A history-API router breaks on reload when the server answers a nested path with the wrong file.

## Considered options

- History-API routing with a server fallback to `index.html`.
- Hash routing.
- Hashed asset names.

## Decision

Routes live in the URL hash (`#/adr/ADR-0001`), so deep links work under any server and base path. Built assets keep fixed names, so the server sends `Cache-Control: no-cache` on every static file and browsers revalidate after an upgrade.

## Consequences

Reload and sharing work without server cooperation. Revalidating on every load costs a conditional request per file, which is cheap on loopback. If the app ever moves behind a CDN, hashed names with long-lived caching should replace this decision.
