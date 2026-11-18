# Local HTTP API

`adrien serve` starts a small read-only HTTP server on top of one ADR log. It is what the web visualizer talks to, and
it is usable from scripts and dashboards. Every response is JSON unless stated otherwise, and the shapes are the types
in `packages/api/src/contract.ts`.

```sh
adrien serve                         # http://127.0.0.1:4310
adrien serve --port 8080 --log ../decisions
```

## Rules

- **Read-only.** There is no endpoint that writes. Proposing and approving decisions stay with the CLI, the MCP server
  and your git host's merge requests.
- **Local by default.** It binds to `127.0.0.1`. A request whose `Host` header is not `localhost`, `127.0.0.1` or `[::1]`
  (plus the host you passed to `--host`) is refused with 403, which blocks DNS-rebinding from a web page.
- **No CORS headers.** Browsers on other origins cannot read it.
- **Stateless.** Each request re-reads the log, so it always shows what is on disk and in git now.
- **Errors** are `{ "error": { "code": "ADR_NOT_FOUND", "message": "…" } }` with 404 for `ADR_NOT_FOUND`, 400 for
  `INVALID_INPUT`, 403 for a refused host, and 500 otherwise.

## Endpoints

| Method and path                         | Returns                                                                                                                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/meta`                         | `MetaResponse`: product, mode, base ref, tag and component vocabularies, counts by status.                                                                                                                                |
| `GET /api/adrs`                         | `AdrsResponse`. Filters: `tag` (repeatable, all must match), `component` (repeatable, any), `status` (repeatable, any), `pending=1` (only pending changes), `q` (full-text search; ranked, so the order is by relevance). |
| `GET /api/adrs/:id`                     | `AdrResponse`: the binding version and the pending change, if any. 404 for an unknown id.                                                                                                                                 |
| `GET /api/graph`                        | `GraphResponse`: one node per ADR and one edge per `supersedes` or `related` link.                                                                                                                                        |
| `GET /api/for?path=a.ts&path=b.ts`      | `ForResponse`: the decisions governing each file (paths are relative to the directory `adrien serve` was started in). At least one `path`.                                                                                |
| `GET /api/check`                        | `CheckResponse`. `lint=1` adds the style warnings.                                                                                                                                                                        |
| `GET /api/export?format=markdown\|llms` | The generated overview as `text/plain`.                                                                                                                                                                                   |
| `GET /` and other paths                 | The web visualizer (static files), with `index.html` as the fallback for client-side routes. 404 JSON for unknown `/api/*`.                                                                                               |
