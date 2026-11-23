---
id: ADR-0030
title: Teams reach Adrien through their own SSO proxy, and every signed-in person is a maintainer unless a role says otherwise
status: proposed
date: 2026-11-23
review_on: 2027-05-23
tags: [api, release]
components: [api, cli]
review_rule: "Adrien itself holds no user accounts and no SSO code: team access comes from an authenticating proxy in front of adrien serve, and a person who signs in is a maintainer unless a role is configured for them."
code: [api:src/auth.ts, cli:src/commands/serve.ts]
related: [ADR-0023]
origin: agent
---

## Context

Decisions exist for a team, so a team must be able to read them in one place, signed in with the company's identity. Today three things cover part of that. The decisions are Markdown in git, so everyone with the repository has them. `adrien serve` can run on a server for a whole team (ADR-0023), but it knows one shared token and has no notion of a person. An authenticating proxy in front of it is already allowed with `--no-auth`. What is missing is a stated model for who may do what, and a decision on whether Adrien becomes a service with its own accounts.

## Considered options

- Git only: the team reads decisions in the repository, in pull requests, and through the local MCP server. Nothing to host.
- Self-hosted `adrien serve` behind the team's own authenticating proxy (single sign-on, VPN or Cloudflare Access), on a VM or in a container. Adrien keeps no accounts.
- A hosted service run by the maintainers, with its own sign-in, organisations, access tokens for git hosts and a remote MCP endpoint.

## Decision

Teams reach Adrien in two ways, both without accounts inside Adrien: the git repository, and `adrien serve` on a server behind the team's own authenticating proxy, started with `--no-auth` or with the shared token as a second lock. Adrien implements no sign-in, no password storage and no identity provider code.

The access model is: **a person who has signed in through the proxy is a maintainer by default.** Nobody is a reader, a guest or an owner unless a role is stated for them. A restriction is something an administrator writes down, never something a person has to ask for. When roles exist, an unlisted person keeps the maintainer role.

Authority over a decision stays where it is: approving is merging in git, so who may accept a decision is decided by the git host's own permissions and by branch protection, not by the visualizer. The server stays read-only. A role in Adrien therefore only governs what a signed-in person may see or do in Adrien itself, and has no effect until Adrien offers an action beyond reading.

Today a maintainer may read everything Adrien shows, and accepting a decision stays a merge in git. Who may sign in at all is the identity provider's and the proxy's policy: that is the real gate behind "maintainer by default". When roles are built, Adrien takes the person's identity from a header the proxy sets, which is safe only if the server can be reached through the proxy and nothing else.

A hosted service run by the maintainers is not decided here. It is a separate product with accounts, git credentials and a remote MCP endpoint, and needs its own ADR if the project goes that way.

## Rationale

A proxy gives teams the sign-in they already trust (their identity provider, its groups, its audit log) and keeps credentials, sessions and identity code out of an open-source tool that must stay small to stay secure. Defaulting to maintainer fits how the decision log is used: the people who sign in are the team that writes the decisions, and a log that asks each person for a role before they can read or propose would be in their way. Real authority already lives in git, so the default does not hand anyone a power they lack there.

## Consequences

The server must be bound to loopback or a private network so that only the proxy can reach it, and a proxy that also uses the shared token adds `Authorization: Bearer <token>` to each forwarded request, so people are not asked for it again after signing in. The documentation must show the proxy setup (the Docker image and `docs/self-hosting.md` already cover the server), and say plainly that `--no-auth` is safe only behind a proxy that authenticates every request. There is no per-person audit trail inside Adrien: the proxy and git hold it. If a later feature lets someone act inside Adrien, such as proposing from the web, roles must be added before it ships, and the maintainer default must be revisited then. This revises ADR-0023's statement that single sign-on and roles wait for a hosted product: sign-on comes from the proxy, and the role model is this one. The server ADR-0023 describes is unchanged.
