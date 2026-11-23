---
id: ADR-0031
title: One Adrien instance serves several workspaces, one per product, plus an optional common one
status: accepted
date: 2026-11-23
review_on: 2027-05-23
tags: [format, api]
components: [core, api, cli]
review_rule: An instance, local or hosted, can serve several workspaces; each workspace is one decision log with its own standards, ids and, in the hosted version, its own roles, and a common workspace binds every product workspace.
related: [ADR-0030, ADR-0023]
origin: agent
---

## Context

An organisation that builds several products does not hold one set of standards. Each product has its own architecture rules, and some rules are common to all of them. Today one Adrien log is one product: its `adrien.config.yaml` names a single `product`, and `adrien serve` serves one log. A company with a word processor, a spreadsheet tool and a slide tool would need three instances, with no way to share the rules they have in common, or to see them together. The word "workspace" is already used in the code for `workspace.yaml`, the list of local checkouts of a log's components; that is a different thing, and the user-facing meaning below is the one this ADR names.

## Considered options

- One log per product, one instance per log, and no link between them.
- One log for everything, with the product as a tag or a component.
- Several workspaces in one instance: each product has its own log (its own standards, template, tags and ids), and a common workspace holds what applies to every product.

## Decision

An Adrien instance, local or hosted, can serve several **workspaces**. A workspace is one decision log, exactly what a log is today: its own `adrien.config.yaml`, ids, template, tags and components. An existing single log is simply an instance with one workspace, so nothing is migrated and nothing changes for someone with one product.

An instance may also have a **common workspace**. Its accepted decisions bind every product workspace, and a product workspace shows them next to its own, marked with where they come from. A product workspace adds its own rules and may not contradict a common one; changing a common rule is done in the common workspace, by superseding it there.

Ids belong to a workspace: `ADR-0007` is meaningful inside one workspace. Across workspaces a decision is named with its workspace, such as `spreadsheet/ADR-0007`. A `supersedes` stays inside one workspace. Across workspaces only references such as `related` are allowed, and they use that full name: a product workspace may refer to a common decision, and a common one does not refer to a product.

In the hosted version (ADR-0030) roles are given per workspace: a person may be a maintainer in one product and a reader in another, and the defaults of ADR-0030 apply in every workspace, the common one included. In a self-hosted instance, which has no roles, the one token or the one proxy gives access to all of its workspaces. The access model of ADR-0030 is unchanged, and serving several logs is the only extension of the server of ADR-0023.

How an instance finds its workspaces (a list in a configuration file, or a folder of logs), the shape of the API paths, and how the MCP server chooses a workspace from the files an agent is editing are left to the implementation, and to a later ADR if they affect the format.

## Rationale

A workspace is a log that already exists, so the model reuses everything: checks, search, the web app, the review rules. Separate logs keep each product's standards apart and let each be read and changed by its own people, which a single shared log with tags cannot do without turning every filter into a security rule. A common workspace that binds the others gives the organisation one place for what is shared instead of copying the same decision into every product, where the copies drift.

## Consequences

The server, the API, the web app and the MCP server must learn to hold several logs and to say which one a decision belongs to; today each assumes one. Search, the graph and `adr_for_files` need a rule for what spans workspaces, at least the common one. Cross-workspace names change what a reference looks like and must be added to the format documentation. A contradiction between a product rule and a common one needs a check that finds it, or a person to notice. The existing `workspace.yaml` should be renamed or clearly documented to avoid confusion with this meaning. A self-hosted instance has one token or one proxy for all its workspaces, so a team that needs products isolated from each other runs separate instances. A company with many products now has many logs to keep consistent, which is the price of keeping their standards apart.
