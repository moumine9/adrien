---
id: ADR-0037
title: The ADR folder adrien init creates is named after the workspace, and a workspace rename moves it
status: proposed
date: 2026-11-27
review_on: 2027-05-27
tags: [format]
components: [core, cli]
code: [core:src/config.ts, core:src/rename.ts, cli:src/commands/init.ts, cli:src/commands/rename-workspace.ts]
review_rule: A log's workspace name is the workspace field of its adrien.config.yaml, set by adrien init, and --log name=path overrides it for one instance only and never names a folder; adrien init writes adr_dir as docs/adr/<workspace> unless --adr-dir is given or docs/adr already holds ADRs, rename-workspace moves an adr_dir of exactly docs/adr/<old> to docs/adr/<new> and rewrites the field, and the name is never part of an ADR's file name or id.
related: [ADR-0033, ADR-0032, ADR-0034]
origin: agent
---

## Context

An instance serves several workspaces at the same time (ADR-0032). ADR-0033 gives each log its name in a `workspace` field of `adrien.config.yaml`, and keeps that name out of every file path. As a result every log created by `adrien init` keeps its decisions in the same `docs/adr` folder. Someone with several logs checked out side by side, a repository that holds several logs, or a person reading the folder shown by the web app sees the same `docs/adr` everywhere and cannot tell from the folder which workspace it holds.

This ADR restates ADR-0033 and changes only where a log's ADR folder is and what a rename does to it. Once accepted, it supersedes ADR-0033.

## Considered options

- Keep ADR-0033: the folder never carries the workspace name, and the web app names the workspace beside the path instead.
- Name the folder after the workspace when `adrien init` creates it, and leave it alone on a rename. The folder would keep the old name after a rename, so the old name would stay in the log.
- Name the folder after the workspace when `adrien init` creates it, and have `rename-workspace` move it when it carries the old name.
- Make `docs/adr/<workspace>` the default the configuration loader uses when `adr_dir` is absent. Every existing log without an `adr_dir` would then be read from a folder that does not exist and show no decisions.

## Decision

A log's `adrien.config.yaml` has an optional `workspace` field, the name of the workspace, as ADR-0033 decided: lowercase letters, digits, `.`, `_` and `-`, starting with a letter or a digit. `adrien init` sets it from `--workspace <name>`, or from the product name slugged. A log without the field is named by the slug of its product, and `default` when a single served log has no usable product name. An instance may override the name of one log with `--log name=path-or-url` or `name=` in `ADRIEN_LOG`. The override changes only that instance's addresses, is never written to the log, and is never used for a folder. A reference written in an ADR file uses the target log's own name (ADR-0034).

`adrien init` writes `adr_dir: docs/adr/<workspace>` and creates that folder. Two cases keep another value. When `--adr-dir` is given, `init` writes that value as it is. When `docs/adr` already holds ADR files, as when an existing log is adopted (ADR-0008), `init` keeps `adr_dir: docs/adr` and says so, so it never creates an empty folder beside the decisions. The configuration loader's default for a log with no `adr_dir` stays `docs/adr`, so existing logs are read where they are.

`adrien rename-workspace <new-name>` moves the log's ADR folder when its `adr_dir` is exactly `docs/adr/<old>`, the shape `adrien init` writes. It moves the folder to `docs/adr/<new-name>`, with every file and subfolder in it, and rewrites `adr_dir` to match. The move is planned and checked before the first write like the rest of the rename. It is refused when `docs/adr/<new-name>` already exists, it is shown by `--dry-run`, and it is undone with the other writes when a write fails. Since it changes the path of every ADR in the log, it first takes every ADR's lock, as `renumber` does (ADR-0026). Any other `adr_dir` was chosen by hand and is left where it is, and the command says so. That includes the `docs/adr` of a log created before this decision, and a folder that only ends with the old name. After a move, the command reminds the user to update any `CODEOWNERS` entry for the old folder. The catch-up form, `--from <old-name>`, renames nothing and moves nothing. A product log reached by a rename has only its references rewritten; its own folder is never moved.

The workspace name is still not part of an ADR's file name, its id or its `id_format`. It enters a path in exactly two places: the `adr_dir` that `adrien init` writes, and the folder that `rename-workspace` moves. Reading a log always uses `adr_dir` as written and never derives a path from the name.

## Rationale

A folder named after the workspace says which log it holds wherever it is seen: in a file tree, in a terminal, in the web app. Writing the name into `adr_dir` once, at `init`, keeps the reading side unchanged: Adrien still reads the path the configuration gives, and a log created before this decision keeps working without a migration. Moving the folder on a rename keeps the folder and the workspace in step, so the old name does not survive in the log. Limiting the move to the exact `docs/adr/<old>` that `init` writes means Adrien moves only a folder it laid out itself. A folder that merely ends with the old name, such as `docs/decisions` in a workspace named `decisions`, may have been chosen by hand, so it stays put. The workspace name pattern has no `/` and cannot be `.` or `..`, so a folder built from it stays inside the log.

## Consequences

A log created by the new `adrien init` keeps its ADRs in `docs/adr/<workspace>`, and the `CODEOWNERS` line `init` suggests names that folder. Versions of Adrien that predate this decision read such a log as they read any `adr_dir`.

A rename that moves the folder changes the path of every ADR in the log, which is the cost of this choice:

- Until the rename is merged, each moved ADR shows as a pending change in the checkout, since each revision is read with its own configuration (ADR-0010) and the files are paired by id.
- Each ADR's modified time (ADR-0027) becomes the date of the commit that moved it, since that time is read from git history without rename detection.
- The `CODEOWNERS` entry that makes merging the approval names the old folder and stops matching. Until it is updated, a change to an ADR no longer needs an architect's approval. The command prints a reminder, but it does not edit `CODEOWNERS`.
- Other links to ADR files from outside the folder, such as a `README` or a code comment, are not rewritten and must be fixed by hand. Links between ADRs in the folder keep working.
- A review gate that refuses renamed ADR files sees every file of the log renamed, and has to allow a move that changes only the folder.

A log created before this decision keeps `docs/adr` until someone moves it by hand, with `git mv` and a new `adr_dir`.
