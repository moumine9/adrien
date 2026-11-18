---
id: ADR-0023
title: Self-hosting is adrien serve with a token and allowed hosts
status: proposed
date: 2026-11-18
review_on: 2027-05-18
tags: [api, release]
components: [api, cli]
code: [api:src/auth.ts, cli:src/commands/serve.ts]
related: [ADR-0019]
review_rule: Beyond loopback, adrien serve refuses to start without ADRIEN_TOKEN or an explicit --no-auth, checks the Host name before the token, and stays read-only.
origin: agent
---

## Context

Adrien must run for a team as well as on a laptop, and the project is open source, so anyone can host it. A separate server product would double the surface to build and secure. The local server already reads the log and serves the web app.

## Considered options

- A separate server package with accounts and a database.
- The same `adrien serve`, made safe to put on a network by a shared token and a list of allowed host names.
- Leave authentication to a reverse proxy only.

## Decision

`adrien serve` is the self-hosted server. Beyond loopback it refuses to start unless `ADRIEN_TOKEN` is set, or `--no-auth` says a proxy authenticates. The token is read from the environment, accepted as a Bearer token or a Basic password, and compared in constant time. The Host name is checked before the token, and `--allowed-host` or `ADRIEN_ALLOWED_HOSTS` names the public host. `GET /healthz` needs no token. A log given as a git URL is fetched on a timer. A Dockerfile packages the published npm package. The server stays read-only.

## Consequences

One shared token means no per-user identity or audit trail, so single sign-on and roles belong to a later, hosted product. Credentials are readable on plain HTTP, so the docs require TLS in front. The default stays local and safe: nothing changes for someone running `adrien serve` on their machine. Approving a decision is still a merge in git, so a self-hosted server needs no write access to the log.
