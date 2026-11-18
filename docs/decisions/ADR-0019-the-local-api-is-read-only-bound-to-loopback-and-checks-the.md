---
id: ADR-0019
title: The local API is read-only, bound to loopback and checks the Host header
status: proposed
date: 2026-11-18
review_on: 2027-05-18
tags: [api, agents]
components: [api]
code: [api:src/**]
review_rule: The API only answers GET and HEAD, binds 127.0.0.1 by default, refuses any Host that is not a loopback name, the bound host or an allowed host, and sends no CORS headers.
origin: agent
---

## Context

A local server that reads the decision log is a small attack surface: any web page open in the user's browser can try to reach it, and a rebinding attack can make a hostile domain resolve to 127.0.0.1. The visualizer only needs to read.

## Considered options

- A read-write API so the web app can accept and edit decisions.
- A read-only API on loopback with a Host allow-list.
- A token-protected API that may listen on any interface.

## Decision

The API answers GET and HEAD only; everything else is 405. It binds 127.0.0.1 by default. It serves a request only when the Host header names a loopback host (`localhost`, `127.0.0.1`, `[::1]`) or the address it was bound to, and answers 403 otherwise. It sends no CORS headers, and every API response carries `Cache-Control: no-store`.

## Consequences

Rebinding and cross-origin reads are closed without tokens or sessions. Approving a decision stays a merge in git, never a click (see the approval decision). Reaching the API from another machine needs an explicit `--host`, a Host the allow-list accepts and a token (see the self-hosting decision), so it is deliberately awkward.
