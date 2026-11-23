# Local HTTP API

`adrien serve` starts a small read-only HTTP server on top of one ADR log (a workspace). It is what the web visualizer
talks to, and it is usable from scripts and dashboards. Every response is JSON unless stated otherwise, and the shapes are the types
in `packages/api/src/contract.ts`.

```sh
adrien serve                         # http://127.0.0.1:4310
adrien serve --port 8080 --log ../decisions
```

## Rules

- **Read-only.** There is no endpoint that writes, and any method but `GET` and `HEAD` is refused with 405. Proposing
  and approving decisions stay with the CLI, the MCP server and your git host's merge requests.
- **Local by default.** It binds to `127.0.0.1`. A request whose `Host` header is not `localhost`, `127.0.0.1` or `[::1]`
  (plus the host you passed to `--host`) is refused with 403, which blocks DNS-rebinding from a web page.
- **Beyond this machine, with a token.** `--allowed-host` (or `ADRIEN_ALLOWED_HOSTS`) adds the names a request may carry.
  With `ADRIEN_TOKEN` set, every request must send it, as `Authorization: Bearer <token>` or as the password of Basic
  authentication, or it gets 401 (`UNAUTHORIZED`) with a `WWW-Authenticate` challenge. The host check comes first.
  `GET /healthz` answers `ok` without a token, for container and load-balancer checks. See
  [self-hosting.md](self-hosting.md).
- **No CORS headers.** Browsers on other origins cannot read it.
- **Stateless.** Each request re-reads the log, so it always shows what is on disk and in git now.
- **Errors** are `{ "error": { "code": "ADR_NOT_FOUND", "message": "…" } }` with 404 for `ADR_NOT_FOUND`, 400 for
  `INVALID_INPUT`, 401 for a missing or wrong token (`UNAUTHORIZED`), 403 for a refused host (`FORBIDDEN_HOST`), 405 for a refused method (`METHOD_NOT_ALLOWED`), 404 for
  an unknown `/api` path (`NOT_FOUND`), 404 for an unknown workspace (`WORKSPACE_NOT_FOUND`), 404 for a flat route
  used while several workspaces exist (`WORKSPACE_REQUIRED`), and 500 otherwise (the Adrien error code, such as
  `CONFIG_NOT_FOUND`, or `INTERNAL_ERROR`). API responses carry `Cache-Control: no-store`.

## Workspaces

One server can serve several logs, each a workspace with a name (`adrien serve --log name=<path or url>`, repeated or
`;`-separated; the other commands take one log). Every route below is served
twice: flat (`/api/adrs`) and under its workspace (`/api/w/<name>/adrs`, for example `/api/w/acme/adrs/ADR-0001`). The
token and the host check are the same for every workspace.

- **The default workspace.** With exactly one workspace, the flat routes are that workspace. With several, a flat route
  answers 404 `WORKSPACE_REQUIRED`, and its message lists the names to use in `/api/w/<name>/...`.
- **Unknown names** answer 404 `WORKSPACE_NOT_FOUND`.
- `GET /api/workspaces` lists them: `{ "workspaces": [{ "name": "acme", "product": "Acme", "default": true }] }`.
  `default` is true only when there is exactly one workspace.
- `GET /api/meta` carries the workspace's `workspace` name, so a response says which log it describes.
- `GET /api/for` takes code paths, not workspace names: they are answered against the workspace the route names.
- A `GET /api/for` decision has `workspace`: `null` for the product's own log, or the name of the common log it comes
  from (the `common` field of `adrien.config.yaml`). When that common log cannot be read, its decisions are left out and
  `common_notes` says why; the product's own decisions are still returned. `notes` stays the product log's own
  verification warning (no default branch), and `common_notes` covers the common log: no default branch, or unreadable.
- A `GET /api/for` decision has `exemption`: `null`, or `{ "by": "ADR-n" }` when an accepted exception of this product
  (`exception_to`, ADR-0035) departs from this common decision for this file. The decision stays listed with
  `binding: false`; the exception holds the rule to follow.
  Each list is present only when it has entries. `notes` also warns when the common log has no
  default branch to verify its decisions against.

## Endpoints

| Method and path                    | Returns                                                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/workspaces`              | `WorkspacesResponse`: the names, products and whether each is the default. Not under a workspace.                                                                                                                         |
| `GET /api/meta`                    | `MetaResponse`: workspace name, product, mode, base ref, tag and component vocabularies, counts by status.                                                                                                                |
| `GET /api/adrs`                    | `AdrsResponse`. Filters: `tag` (repeatable, all must match), `component` (repeatable, any), `status` (repeatable, any), `pending=1` (only pending changes), `q` (full-text search; ranked, so the order is by relevance). |
| `GET /api/adrs/:id`                | `AdrResponse`: the binding version and the pending change, if any. 404 for an unknown id.                                                                                                                                 |
| `GET /api/graph`                   | `GraphResponse`: one node per ADR and one edge per `supersedes` or `related` link.                                                                                                                                        |
| `GET /api/for?path=a.ts&path=b.ts` | `ForResponse`: the decisions governing each file (paths are relative to the directory `adrien serve` was started in). At least one `path`.                                                                                |
| `GET /api/check`                   | `CheckResponse`. `lint=1` adds the style warnings.                                                                                                                                                                        |
| `GET /api/export?format=markdown\  | llms`                                                                                                                                                                                                                     |
| `GET /` and other paths            | The web visualizer (static files), with `index.html` as the fallback for client-side routes. 404 JSON for unknown `/api/*`.                                                                                               |

Every endpoint above except `/api/workspaces` is also served as `/api/w/<name>/...` (for example `/api/w/acme/graph`).

## Revision and modified time

Each row of `GET /api/adrs` and each `GET /api/adrs/:id` response carries two fields about the version in this checkout,
the one `adrien show --json` describes:

- `revision`: the value to pass as `--expect` (CLI) or `base_revision` (MCP) when changing the ADR, so a change based on an
  older read is refused. It is the same value `adrien show --json` and `adr_get` return. `null` when the ADR is not in
  this checkout (deleted here) or its id is used by several files.
- `modifiedAt`: an ISO 8601 time. It is the file's modification time when this checkout changes the ADR or there is no
  default branch to read. Otherwise it is the time of the last commit in this checkout that touched the file, since a
  clone resets file times (an ADR that only the default branch holds takes that branch's last commit instead). `null` when
  it cannot be known, as in a shallow clone.
