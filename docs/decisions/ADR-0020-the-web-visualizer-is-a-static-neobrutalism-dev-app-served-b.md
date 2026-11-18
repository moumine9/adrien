---
id: ADR-0020
title: The web visualizer is a static neobrutalism.dev app served by the CLI
status: proposed
date: 2026-11-18
review_on: 2027-05-18
tags: [ui]
components: [web, cli]
code: [web:src/**, cli:scripts/copy-web.mjs]
review_rule: The web app is built with Vite into static files, uses neobrutalism.dev components, talks only to the same-origin API and ships inside the adrien package.
origin: agent
---

## Context

The project needs a visual overview for people who prefer one, and the owner asked for a neo-brutalist look based on neobrutalism.dev. `adrien` is installed with `npx`, so the UI cannot need a second install or a Node build step.

## Considered options

- A server-rendered page from the CLI.
- A separate hosted web app.
- A static single-page app built with Vite, shipped inside the npm package and served by `adrien serve`.

## Decision

`packages/web` is a Vite, React and TypeScript app styled with Tailwind v4 and the neobrutalism.dev components (which are built on Base UI). It reads the local API on the same origin only. The CLI build copies `packages/web/dist` into `dist/web`, and `adrien serve` serves it. Markdown is rendered without raw HTML.

## Consequences

One package carries all four surfaces and the UI works offline. The npm package grows by about 280 KB gzipped, fonts included. The web build must run before the CLI build, so the CLI lists the web package as a build dependency. The component code is copied into the repo, so upstream fixes need a manual update.
