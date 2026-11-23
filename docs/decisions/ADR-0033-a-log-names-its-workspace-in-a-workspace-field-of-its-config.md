---
id: ADR-0033
title: A log names its workspace in a workspace field of its configuration
status: proposed
date: 2026-11-23
review_on: 2027-05-23
tags: [format]
components: [core, cli]
code: [core:src/config.ts, cli:src/commands/init.ts]
review_rule: A log's workspace name is the workspace field of its adrien.config.yaml, set by adrien init, and is never part of an ADR's file name or id; --log name=path overrides it for one instance.
related: [ADR-0032, ADR-0030]
origin: agent
---

## Context

ADR-0032 says an Adrien instance serves several workspaces, each one a decision log with its own configuration, and that cross-workspace references name a decision with its workspace, such as `spreadsheet/ADR-0007`. It does not say where a workspace gets its name. That name appears in addresses (`/api/w/<name>/`, `#/w/<name>/`), in references written inside ADR files, and in the messages of the tools, so it must stay the same when the product is renamed, when a log is moved, and from one instance to another. The product name in `adrien.config.yaml` is free text meant for people, and the folder name changes with a checkout.

## Considered options

- Take the name from the `product` field of the configuration, slugged.
- Declare the name only on the instance, with `adrien serve --log name=path`.
- Write the name in the log's own configuration, as a `workspace` field, and let an instance override it.

## Decision

A log's configuration `adrien.config.yaml` has an optional field `workspace`: the name of the workspace. It uses lowercase letters, digits, `.`, `_` and `-`, and starts with a letter or a digit. `adrien init` sets it, from `--workspace <name>`, or from the product name slugged when the option is not given. A log without the field keeps working: its name is the slug of its product, and `default` when a single served log has a product name with no letters or digits of the ASCII alphabet. A name has to be set, in the configuration or on the instance, only when the product name gives no usable name and several logs are served.

An instance may override the name of one log: `--log name=path-or-url`, or `name=` in `ADRIEN_LOG`. The override is for that instance only and is never written to the log. It changes only the addresses of that instance (`/api/w/<name>/`, `#/w/<name>/`): a reference written in an ADR file always uses the target log's own name, its `workspace` field and then its product slug (ADR-0034), so an override never changes how a reference resolves. Within an instance names are unique, and the same log cannot be listed twice.

The workspace name is not part of an ADR's file name, of its id, or of its `id_format`. Files and ids stay as they are, so renaming a workspace never renames an ADR file. A rename changes the field, and what refers to the old name: the references from other workspaces (ADR-0034) and the addresses and bookmarks that carry it.

The name is only ever looked up among the workspaces of an instance. It is never joined into a file path.

## Rationale

A name that lives in the log's configuration travels with the repository, so every instance, every clone and every agent that reads the log gives the same name to it. The product name cannot serve: it is a label for readers, and renaming a product would break every reference. A name declared only on the instance would differ between instances, and a reference written in an ADR file would mean different things in each. Keeping the name out of file names and ids means a rename never touches a file, so the history of each ADR and every link to its file stay intact.

## Consequences

Adrien 0.9.0 and earlier read the configuration strictly and reject a `workspace` field, so a log created with the new `adrien init` cannot be opened by an older version. A log that already exists is unaffected. `adrien init` now fails when it cannot derive a name, for example from a directory with no ASCII letters, and asks for `--workspace`. Renaming a workspace is not done by hand: a later change should offer a command that updates the field and the references that name it, in every log it can reach.
