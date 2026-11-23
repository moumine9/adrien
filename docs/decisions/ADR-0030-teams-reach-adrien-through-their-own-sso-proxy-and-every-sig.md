---
id: ADR-0030
title: Self-hosted Adrien stays as it is, without accounts; people and the roles administrator, maintainer and reader belong to a hosted version
status: proposed
date: 2026-11-23
review_on: 2027-05-23
tags: [api, release]
components: [api, cli]
review_rule: "adrien serve holds no user accounts, roles or SSO code: it stays one shared token or an authenticating proxy in front. People and the roles administrator, maintainer and reader exist only in a hosted version, where a person who signs in is a maintainer unless a role says otherwise."
code: [api:src/auth.ts, cli:src/commands/serve.ts]
related: [ADR-0023, ADR-0003]
origin: agent
---

## Context

Decisions exist for a team, so a team must be able to read them in one place. Two kinds of team exist. One runs Adrien itself, on a VM or in a container, and wants nothing from the project beyond the program. The other wants a service it does not run, with several people and different powers for each. Today the decisions are Markdown in git, so everyone with the repository has them, and `adrien serve` can run on a server for a whole team (ADR-0023) with one shared token, or behind an authenticating proxy with `--no-auth`. It has no notion of a person.

## Considered options

- Give `adrien serve` accounts and roles, so the self-hosted program and a service are the same thing.
- Keep `adrien serve` as it is, and give people and roles only to a separate hosted version.
- Never offer a hosted version: git and self-hosting only.

## Decision

The self-hosted version stays exactly what it is: one shared token, or an authenticating proxy in front of it (single sign-on, VPN, Cloudflare Access), read-only, with no accounts, no roles and no sign-in code inside it. A team that self-hosts may put its own proxy in front, and its own identity provider decides who gets in.

A hosted version, run by the maintainers of Adrien, differs from it in one way: it knows people. A person signs in through single sign-on and holds one of three roles, some with read and write rights and others read-only:

- **Administrator**: reads and writes like a maintainer, and also manages the organisation's people and roles, its connected repositories and its access settings.
- **Maintainer**: reads and writes. A maintainer can read every decision and take part in the decision work of the organisation.
- **Reader**: read-only. A reader sees every decision and can change nothing.

Who may sign in at all is the policy of the organisation's identity provider. A person who signs in is a maintainer by default, and stays one until a role is stated for them. A restriction is something an administrator writes down, never something a person asks for. An unlisted person keeps the maintainer role.

Authority over a decision still lives in git: approving is merging, so who may accept a decision is decided by the git host's permissions and branch protection. A role in the hosted version governs what a person may see and do in Adrien itself. Write access means proposing and editing decisions through the service. A write lands as a branch and a pull request, the pending layer, and never on the default branch; only proposed decisions can be edited, and an accepted one changes only through a new decision that supersedes it. Whether a maintainer may also accept a decision from the service is not decided here: it touches ADR-0003 and the rule that approval is a merge, and needs its own ADR before it ships.

The hosted version, its hosting, git credentials and a remote MCP endpoint are product decisions for later ADRs. This ADR fixes only the line between the two versions and the shape of the roles.

## Rationale

Keeping accounts out of the program keeps the open-source tool small, easy to audit and safe to run, and lets a team that self-hosts rely on the identity system it already trusts. People and roles belong to the hosted version, where they can be built once for an organisation instead of rebuilt in every deployment. Defaulting to maintainer fits how the log is used: the people who sign in are the team that writes the decisions, and a tool that asks each person for a role before they can work is in their way. The default is bounded by three things: the identity provider decides who can sign in, a write only opens a pull request, and merging needs rights on the git host.

## Consequences

Self-hosting needs no change and no migration: ADR-0023 still describes the server. The documentation must say that `--no-auth` is safe only behind a proxy that authenticates every request, that the server must then be reachable through the proxy and nothing else, and that a proxy which also uses the token adds `Authorization: Bearer <token>` to each forwarded request. There is no per-person audit trail in the self-hosted version: the proxy and git hold it. The hosted version needs an identity model, a store for people and roles, and an audit trail, and must settle how a write reaches git, and who may accept, before it offers any write. This is consistent with ADR-0023, which left single sign-on and roles to a hosted product: for self-hosting they never arrive, and for the hosted version they are the roles above.
