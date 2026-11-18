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
| `deciders`                               | Who decided.                                                                                     |
| `origin`                                 | `manual` (default, left out of the file), `agent` or `mined`.                                    |
| `contested`                              | `true` when the decision is known to be disputed.                                                |

Keys Adrien does not know are kept, in their original order.

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
none of those exist, ADR statuses are read as written and nothing is verified as merged. In CI, fetch the default branch
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
- `$ADRIEN_HOME/workspace.yaml`:

  ```yaml
  components:
    billing-service: /work/billing
  ```

Without a checkout, `check` reports one `anchors-not-verified` line and never passes silently. In each code repo's CI,
`adrien check --here` verifies that repo's anchors against the checkout it runs in, so a rename that breaks an anchor is
flagged in the same merge request.

`ADRIEN_HOME` defaults to `~/.adrien`.

## `adrien check`

| Code                               | Severity | Meaning                                                                      |
| ---------------------------------- | -------- | ---------------------------------------------------------------------------- |
| `parse-error`                      | error    | A file could not be read as an ADR.                                          |
| `unknown-tag`, `unknown-component` | error    | Not in the config.                                                           |
| `invalid-anchor`                   | error    | Not `component:glob`, or an unknown component.                               |
| `duplicate-id`                     | error    | Two ADRs share an id, across the default branch and your changes.            |
| `broken-link`                      | error    | `supersedes`, `superseded_by` or `related` names an ADR that does not exist. |
| `supersede-asymmetry`              | error    | One side of a supersession is missing.                                       |
| `missing-review-rule`              | error    | An accepted ADR has no `review_rule`.                                        |
| `stale-anchor`                     | warning  | An anchor matches no file in a checkout.                                     |
| `pending-proposed`                 | warning  | (`--mr`) A changed ADR is still `proposed`.                                  |
| `anchors-not-verified`             | info     | Components with no local checkout.                                           |

Exit codes: `0` ok, `1` check errors (or warnings with `--strict`) or duplicate titles on `new`, `2` a usage or
configuration error, `3` an unexpected error (set `ADRIEN_DEBUG=1` for the stack).

## `adrien lint`

`adrien lint` (or `adrien check --lint`) reports how the ADRs read, as warnings that never fail the build unless you pass
`--strict`. It runs [markdownlint](https://github.com/DavidAnson/markdownlint) over each ADR with settings tuned for
ADRs (as MADR does: no line-length limit, repeated headings allowed, no required H1 because the title lives in the
frontmatter), plus three Adrien rules: a template placeholder left in the text, an accepted ADR whose Decision section is
empty, and numbered headings. Fenced code and inline code are ignored.

## The MCP server

`adrien mcp` serves these tools on stdio, from the code repo or log repo it runs in:

| Tool                     | Purpose                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| `adr_for_files`          | The decisions governing the files you are about to change, with their `review_rule`.               |
| `adr_search`, `adr_list` | Find decisions by text, tag, component or status.                                                  |
| `adr_get`                | One ADR: the binding version and any pending change.                                               |
| `adr_propose`            | Record a new decision as `proposed`, origin `agent`. Returns likely duplicates instead of writing. |
| `adr_propose_change`     | Edit an ADR in the working copy; the merge request is the approval.                                |

No tool can set `status` or `origin`: an agent never accepts a decision.
