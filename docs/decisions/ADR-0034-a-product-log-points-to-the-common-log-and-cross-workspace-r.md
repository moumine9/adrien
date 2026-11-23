---
id: ADR-0034
title: A product log points to the common log, and cross-workspace references use workspace/ADR-n in related
status: accepted
date: 2026-11-23
review_on: 2027-05-23
tags: [format]
components: [core, api, mcp, web, cli]
code: [core:src/for-files.ts, core:src/workspaces.ts, mcp:src/tools.ts]
review_rule: A product log names the common log in a common field of its configuration; the accepted decisions of the common log bind the product, and only related and exception_to may cross workspaces, written workspace/ADR-n.
related: [ADR-0032, ADR-0033]
origin: agent
---

## Context

ADR-0032 says a common workspace holds decisions that bind every product workspace of an instance. It leaves three things open. How a product learns where the common log is, which matters for an agent working in a product's code repository on a laptop as much as for a server. How a decision in one workspace names a decision in another. And when a common decision binds a given file. ADR-0033 gives each workspace a stable name.

## Considered options

- Mark the common workspace by a name, such as `common`, and let the instance find it.
- Name the common workspace only on the instance, with a flag of `adrien serve`.
- Let each product log say where the common log is, in its own configuration.

## Decision

A product log's configuration has an optional field `common`: where the common log is, a path or a git URL, like the `--log` option. A relative path resolves against the root of the product log, as the `log:` of `.adrien.yaml` resolves against its own folder. The product is then bound by the accepted decisions of that log. Setting it is the product's choice, it travels with the product repository, and it works on a laptop as well as on a server. In an instance where the common log is also served, it is the same workspace, recognised by its location, and is shown as the common one. When the product names the common log by a URL and the instance serves a local checkout of it, which one is read is left to the implementation, and the log the product names is the one that binds. The common log's own configuration has no such field.

Only the accepted decisions of the common log bind a product. A proposed or rejected one does not. Decisions of the common log reach a product wherever a decision reaches it today, marked with the workspace they come from: `adrien for`, the `adr_for_files` tool, the lists and pages of the viewer, and the API, whose decision responses name their workspace. A common decision binds a product's files by the same rule as the product's own decisions: through its `components` or its `code` anchors, with each component name resolved against the product's own configuration. A common decision that names a component the product does not have binds nothing in that product. One with neither components nor anchors binds no file, as in a single log today. How a rule meant for every component of every product is written is left to a later decision.

A reference from one workspace to another is written `workspace/ADR-n`, for example `common/ADR-0004`, where the prefix is the name of the target log itself, its `workspace` field and then its product slug, never the name an instance gives it. It is allowed in `related` and in `exception_to` (ADR-0035). `supersedes` and `superseded_by` stay inside one workspace. A product may refer to a common decision, and a common decision does not refer to a product. A reference that cannot be resolved because the log is not reachable is reported as information by `adrien check`; when the log is reachable and has no such decision it is a broken link, an error like any other. These reports follow ADR-0006: only errors, or warnings under `--strict`, change the exit code.

## Rationale

A field in the product's configuration is the only choice that works without a server and keeps the binding in the repository that is bound, where it can be reviewed like any other change. A naming convention would force every organisation to call its shared log `common`, and a flag of the server would hide the binding from the agent that works in a code repository. Allowing only `related` and `exception_to` to cross workspaces keeps the supersede chain of each log self-contained, so a log can be read and checked alone. Using the full name `workspace/ADR-n` keeps references unambiguous now that two logs can both have an `ADR-0004`.

## Consequences

Adrien needs to read a second log when a product names one, and to say where each decision comes from. The tools that answer "which decisions govern these files" (`adrien for`, `adr_for_files`, the API) and the viewer change, and so does the format documentation. A product that reaches the common log through a git URL depends on that log being reachable. An accepted common decision now binds products that did not write it, so ADR-0035 gives them a recorded way to depart from it. Older versions reject the new `common` field, as they reject `workspace` (ADR-0033).
