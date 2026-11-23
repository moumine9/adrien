# Adrien format reference

Everything Adrien reads and writes is plain files in your git repositories. This page is the reference for those files.

## Where things live

| What            | Where                                  | Holds                                                     |
| --------------- | -------------------------------------- | --------------------------------------------------------- |
| The **ADR log** | one folder per product, in any repo    | the ADR markdown files and `adrien.config.yaml`           |
| A **code repo** | each repo that has code an ADR governs | an optional `.adrien.yaml` pointing at the log            |
| The **index**   | `<log>/.adrien/index.db`               | a SQLite search index, rebuilt on demand, never committed |

A product can span many code repos (for example a backend split into services). Its log can sit in a dedicated
decisions repo or inside one of the code repos.

## ADR files

Any `*.md` file under the log's `adr_dir` (default `docs/adr`), at any depth, is an ADR if its name starts with a number
(`0007-use-postgres.md`, `ADR-0007-use-postgres.md`) or its frontmatter has an `id`. Subfolders are only for your own
organisation. Adrien writes new files as `<id>-<slug>.md`.

Plain MADR, log4brains and adr-tools files are read as they are: a `# Title` heading, a `Status:` bullet or an
adr-tools `## Status` section fill in what the frontmatter leaves out.

### Frontmatter

```yaml
---
id: ADR-0007
title: Store invoices in Postgres, not in the document store
status: accepted
date: 2026-03-04
review_on: 2027-03-04
tags: [backend, database]
components: [billing-service]
code: ["billing-service:src/Invoices/**"]
review_rule: Invoices are read and written through the repository, never the document client.
sources: ["gitlab:acme/billing-service!171", "jira:ACME-123"]
supersedes: []
superseded_by: ADR-0012
related: [ADR-0003]
deciders: [alice, bob]
origin: manual
contested: false
---
```

| Key                                      | Meaning                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `id`                                     | Unique in the log. Its format comes from `id_format` in the config.                              |
| `title`                                  | One line naming the decision.                                                                    |
| `status`                                 | `proposed`, `accepted`, `rejected`, `superseded` or `deprecated`.                                |
| `date`                                   | The decision date. `adrien new` sets it to today.                                                |
| `tags`                                   | The kind of concern. Every tag must be in the config's `tags` list.                              |
| `components`                             | Where it applies. Every component must be in the config's `components`.                          |
| `code`                                   | Anchors: the files the decision governs, as `component:glob`.                                    |
| `review_rule`                            | One checkable sentence a reviewer or an agent applies to a change. **Required once `accepted`.** |
| `sources`                                | Where the decision was made: merge requests, tickets, chat. Free-form strings.                   |
| `supersedes`, `superseded_by`, `related` | Links to other ADR ids. They must resolve, and supersession must go both ways.                   |
| `exception_to`                           | Common decisions this one departs from, as `workspace/ADR-n`. Needs `review_on`; see below.      |
| `deciders`                               | Who decided.                                                                                     |
| `origin`                                 | `manual` (default, left out of the file), `agent` or `mined`.                                    |
| `contested`                              | `true` when the decision is known to be disputed.                                                |

Keys Adrien does not know are kept, in their original order.

A `related` entry may name a decision of another log as `workspace/ADR-n`, for example `common/ADR-0004`. The prefix is
the target log's own name, its `workspace` (or its product name slugged when `workspace` is not set). `supersedes` and
`superseded_by` stay within one log. `adrien check` resolves such an entry in one of three ways:

- The prefix is this log's own name, or the log named by the `common` field of the configuration is readable and has
  that name: the entry resolves when the decision exists there (any status), and is a `broken-link` error when it does
  not.
- The log named by the prefix cannot be reached from this one: the entry is reported as `unresolved-ref` information,
  which never changes the exit code. A `common` that cannot be reached (a missing path, a failed clone) is reported once as `common-unreadable`, also information; one that was read but cannot serve (it is the product log itself, or has no usable workspace name) is a `common-invalid` error.
- The text has a `/` but is not a valid `workspace/ADR-n`: an `invalid-ref` error. An id of this log wins, even when its own `id_format` puts a slash in it, and the id after the slash is written as the target log writes it.

An accepted decision with `exception_to` departs from decisions of the common log. Each entry is a `workspace/ADR-n` of
that log, resolved as a `related` entry is, except that the product's own name is not allowed: a plain id, or a prefix
equal to this log's name, is an `invalid-ref` error. An exception exempts the files it governs from the common decisions
it names: all the files of the product when it has no `code` anchors, otherwise only the files its anchors match. The
exempted common decision stays listed, marked `EXEMPT (by ADR-n)`, and is not binding for those files. Only an accepted
exception on the default branch exempts anything. An exception needs `review_on`: without it `adrien check` warns with
`exception-without-review`. Once the review date passes it is reported as due like any decision, and it stays in force
until it is renewed, replaced or removed.

### Body

Free markdown. The template for new ADRs is:

```markdown
## Context

## Considered options

## Decision

## Rationale

## Consequences
```

MADR 4 files work as they are. Its `decision-makers`, `consulted` and `informed` keys are kept exactly as written, even
when Adrien rewrites the file, and the `Decision Outcome` section is what agents are shown as the reason.

### Anchors

`code: ["billing-service:src/Invoices/**"]` means: the files matching `src/Invoices/**` inside the component
`billing-service`. The part before the first `:` is a component id, never a repo; the glob is relative to that
component's root and uses [picomatch](https://github.com/micromatch/picomatch) syntax (dotfiles included).
An ADR that lists a component in `components` but has no anchor for it applies to every file of that component.

## Status and approval

**An ADR is binding only when it is `accepted` on the log repo's default branch.** Adrien resolves the default branch as
`origin/HEAD`, then `origin/main`, `origin/master`, `main`, `master`. If the log is not in git, the repo has no commits, or
none of those exist, ADR statuses are read as written and nothing is verified as merged; `adrien for` and the
`adr_for_files` tool say so in a note. In CI, fetch the default branch
first (`adrien check --mr` does).

Everything that differs from it, in your working tree or on your branch, is **pending**: shown to you, labelled, and
never binding, whatever its `status:` field says. That is why an agent can propose or edit an ADR but can never make
its own change authoritative.

The approval flow is the one your platform already has:

1. A developer or an agent runs `adrien new` (or the `adr_propose` MCP tool). The ADR is written as `proposed`.
2. They commit it and open a merge request against the log repo.
3. An architect reviews it. `adrien accept <id>` sets `status: accepted` and the date.
4. **Merging is the approval.** Add the ADR folder to `CODEOWNERS` (`docs/adr/ @your-architects`) and require code-owner
   approval on the default branch, so only architects can merge.

`adrien check --mr` warns when an ADR changed in the merge request still says `proposed`: merged as it is, it would be a
hint, not a decision.

## `adrien.config.yaml` (in the log repo)

```yaml
product: acme
workspace: acme
adr_dir: docs/adr # default
id_format: "ADR-{n:4}" # default; {n} means no padding
tags: [frontend, backend, database, infra, security]
components:
  billing-service:
    repo: https://gitlab.example.com/acme/billing-service
  web:
    repo: . # the same repo as the log (a monorepo)
    root: apps/web # the component's folder inside that repo
```

- `workspace` is the name of this log: lowercase letters, digits, `.`, `_` and `-`. When it is absent, the product name, lower-cased and slugged, is used; `adrien init --workspace <name>` sets it. A server that serves only one log, whose product has no ASCII name and which has no `workspace`, calls it `default`.
- `common` says where the common log is: a path, relative to the root of this log, or a git URL, as for `--log`. The
  accepted decisions of the common log bind this product, matched to its files by the same rule as its own decisions.
  Proposed and rejected decisions of the common log bind nothing. The common log's own `common` field is ignored. Versions
  of Adrien that predate this field reject it.
- `template` picks the headings `adrien new` starts from (`adrien new --template minimal` overrides it for one ADR):
  `standard` (Context, Considered options, Decision, Rationale, Consequences), `minimal` (Context, Decision,
  Consequences) or `madr` (MADR 4's section names, including Confirmation).
- `lint.markdownlint` overrides markdownlint rule settings for `adrien lint`, for example `lint: { markdownlint: { MD013: true } }`.
- `tags` and component ids are lowercase letters, digits, `.`, `_` and `-`. `:` is reserved for anchors.
- A component lives in exactly one repo and one root. A backend service and its micro-frontend are two components.
- `repo` is matched against a checkout's git remote, so `https://…`, `git@…:` and `ssh://…` forms of the same repo are
  the same repo, with or without `.git`.

## `.adrien.yaml` (in a code repo)

```yaml
log: ../decisions # a path, relative to this file
# log: https://gitlab.example.com/acme/decisions # or a git URL
components: [billing-service] # optional: override detection by git remote
```

A URL log is cloned once into `$ADRIEN_HOME/cache` and is **read-only**: reading works, and proposing a change tells you
to check out the log repo and point `log:` at its local path. `adrien sync` refreshes the clone.

Run `adrien init --code-repo --log <path|url>` to write it, and `adrien init --agents` to add the Adrien block to
`AGENTS.md`.

## Finding the log

In order: the `--log <path|url>` option, then an `adrien.config.yaml` found in the current directory or above it, then
a `.adrien.yaml` found the same way, then its `log:`.

## Local checkouts of other repos

Anchors are verified only against repos you have checked out. Tell Adrien where they are with either:

- `ADRIEN_REPOS="billing-service=/work/billing;web=C:\work\web"` (semicolon-separated `component=path`), or
- `$ADRIEN_HOME/checkouts.yaml` (earlier versions called it `workspace.yaml`, which is still read when there is no `checkouts.yaml`):

  ```yaml
  components:
    billing-service: /work/billing
  ```

Without a checkout, `check` reports one `anchors-not-verified` line and never passes silently. In each code repo's CI,
`adrien check --here` verifies that repo's anchors against the checkout it runs in, so a rename that breaks an anchor is
flagged in the same merge request.

`ADRIEN_HOME` defaults to `~/.adrien`.

## Changing an ADR from several places

The CLI, an MCP server and an editor can all touch the same log at once. Adrien keeps one writer per ADR: a command that
changes an ADR (`accept`, `status`, `supersede`, `renumber`, and the changes an agent proposes) first takes that ADR's
lock, a small file under `.adrien/locks/` that git ignores, and holds it for the read, the change and the write. A second
process waits for it, up to 5 seconds (set `ADRIEN_LOCK_TIMEOUT_MS` to change that), and then fails with `ADR_LOCKED`,
naming the ADR and the holder. Nothing is written in that case, so it is safe to try again. The lock protects each
change; the revision, below, protects a change that was planned on an older read.

- `supersede` locks both ADRs, and `renumber` locks every ADR in the log, since it can rewrite the ones that refer to the
  one it moves. Locks are always taken in the same order, so two commands cannot wait on each other.
- A lock whose process is gone (on this machine), or that has been held for 30 seconds, is taken over, so a crashed command
  never leaves an ADR stuck. Locks live in the working copy: a log is changed in one checkout at a time, and the merge
  request is where two checkouts meet.
- **A change made on an old read is refused, like a rejected push.** Every read of an ADR gives its `revision`, a short
  hash of the file (`adrien show <id> --json`, and the MCP tool `adr_get`). A change that names that revision is applied
  only if the ADR still has it: `--expect <revision>` on `accept` and `status`, and `base_revision` on the MCP tool
  `adr_propose_change`, which requires it. If someone changed the ADR in between, whether another agent, the CLI or an
  editor, the change fails with `ADR_CONFLICT` and writes nothing. Read the ADR again, redo the change on the latest
  version, and retry. Without a revision, a command applies to the latest version.
- Creating an ADR needs no lock on an existing one: new ids are reserved with their own marker, so two processes never
  create the same id.

## Backups

`adrien backup create` copies the decision files (every file in the ADR directory, recursively, and
`adrien.config.yaml`) into `.adrien/backups/<UTC time>-<reason>/`, with a `manifest.json` that records the SHA-256 of
each file. The folder is git-ignored, like the locks and the index.

Only the log the current directory belongs to is backed up. A remote log (a URL) is never cloned for a backup; `update`
skips it, and `backup create` or `backup restore` refuse a read-only clone.

Adrien makes a backup on its own in two cases:

- **Before `adrien update` installs a new version** of a global install, with the reason `before-update-<version>`. If
  the backup fails, the update stops before npm runs. After the install, the files are compared with that backup. If
  one of them differs, the update exits 1 and prints the `adrien backup restore` command to run. A log whose ADR
  directory cannot hold backups (for example `adr_dir: .`) is reported as skipped, and the update still installs.
- **Before `adrien backup restore`**, with the reason `pre-restore`, so the restore can itself be undone.

Only the 10 newest backups are kept. `adrien backup list` shows them, `adrien backup verify <id>` compares the current
files with one (exit 1 when any differ), and `adrien backup restore <id>` puts the files back. A restore checks every file
against the manifest before it writes anything. It never deletes a decision file: a file the backup does not have is
reported as left in place.

## `adrien check`

| Code                               | Severity | Meaning                                                                                            |
| ---------------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `parse-error`                      | error    | A file could not be read as an ADR.                                                                |
| `unknown-tag`, `unknown-component` | error    | Not in the config.                                                                                 |
| `invalid-anchor`                   | error    | Not `component:glob`, or an unknown component.                                                     |
| `duplicate-id`                     | error    | Two ADRs share an id, across the default branch and your changes.                                  |
| `broken-link`                      | error    | `supersedes`, `superseded_by`, `related` or `exception_to` names an ADR that does not exist.       |
| `supersede-asymmetry`              | error    | One side of a supersession is missing.                                                             |
| `superseded-without-successor`     | warning  | Status is `superseded`, but `superseded_by` is empty and no ADR lists it.                          |
| `missing-review-rule`              | error    | An accepted ADR has no `review_rule`.                                                              |
| `stale-anchor`                     | warning  | An anchor matches no file in a checkout.                                                           |
| `pending-proposed`                 | warning  | (`--mr`) A changed ADR is still `proposed`.                                                        |
| `review-due`                       | warning  | `review_on` is today or earlier, and the status is not retired (rejected, superseded, deprecated). |
| `exception-without-review`         | warning  | An ADR with `exception_to` has no `review_on`: an exception needs a date to be looked at again.    |
| `filename-convention`              | warning  | (`--lint`) File name is not `<id>-lowercase-words.md`, as `adrien new` writes it.                  |
| `anchors-not-verified`             | info     | Components with no local checkout.                                                                 |
| `invalid-ref`                      | error    | Not an id or `workspace/ADR-n`, a `/` in `supersedes`, or a bad `exception_to` entry.              |
| `unresolved-ref`                   | info     | A `workspace/ADR-n` in `related` or `exception_to` names a log this one cannot reach.              |
| `common-unreadable`                | info     | The `common` field names a log that cannot be reached, so references to it were not checked.       |
| `common-invalid`                   | error    | The `common` field names the product log itself, or a log with no usable workspace name.           |

Exit codes: `0` ok, `1` check errors (or warnings with `--strict`) or duplicate titles on `new`, `2` a usage or
configuration error, `3` an unexpected error (set `ADRIEN_DEBUG=1` for the stack).

## `adrien lint`

`adrien lint` (or `adrien check --lint`) reports how the ADRs read, as warnings that never fail the build unless you pass
`--strict`. It runs [markdownlint](https://github.com/DavidAnson/markdownlint) over each ADR with settings tuned for
ADRs (as MADR does: no line-length limit, repeated headings allowed, no required H1 because the title lives in the
frontmatter), plus four Adrien rules: a template placeholder left in the text, an accepted ADR whose Decision section is
empty, numbered headings, and a file name that is not `<id>-lowercase-words.md` (`filename-convention`, where the id
follows `id_format`, suffix included: `ADR-0001-RFC-use-postgres.md`; a bare `0007-use-postgres.md` is accepted). Fenced code and inline code are ignored.

## `adrien export`

`adrien export` prints an overview of the ADRs in your checkout: a markdown table of every ADR by default, or with
`--format llms` an [llms.txt](https://llmstxt.org) that lists the accepted decisions with their `review_rule`, so a model
can read them from one file. "Accepted" means what the default branch holds: an edit made in your checkout is listed
under "Pending in this checkout" until it is merged. `--out <file>` writes it instead, with links relative to that file. The output is
generated: regenerate it rather than editing it.

## `adrien review`

`adrien review [--base <ref>] [--head <ref>] [--files <paths...>]` writes the Markdown comment for a merge request: the
decisions that govern the files it changes, with each `review_rule`. With no `--files`, it compares `--base` (default:
the default branch) with `--head` (default: `HEAD`). It informs and never blocks: it exits `0` whatever it finds, and it
posts nothing. [ci.md](ci.md) shows how a GitHub or GitLab job posts it and keeps one comment up to date.

## `adrien serve`

`adrien serve [--port <n>] [--host <h>]` starts a read-only HTTP server on `127.0.0.1:4310` for the web visualizer,
scripts and dashboards, and prints its URL. It runs until you stop it. The endpoints and the security rules are in
[api.md](api.md). To serve a team from a server, with a token and a Docker image, see
[self-hosting.md](self-hosting.md).

## The MCP server

`adrien mcp` serves these tools on stdio, from the code repo or log repo it runs in:

| Tool                     | Purpose                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `adr_for_files`          | The decisions governing the files you are about to change, with their `review_rule`.                                                 |
| `adr_search`, `adr_list` | Find decisions by text, tag, component or status.                                                                                    |
| `adr_get`                | One ADR: the binding version and any pending change.                                                                                 |
| `adr_propose`            | Record a new decision as `proposed`, origin `agent`. Returns likely duplicates instead of writing, and says when not to propose one. |
| `adr_propose_change`     | Edit an ADR in the working copy; the merge request is the approval.                                                                  |

No tool can set `status` or `origin`: an agent never accepts a decision.
