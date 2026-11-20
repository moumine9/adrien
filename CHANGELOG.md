## [0.7.0](https://github.com/moumine9/adrien/compare/v0.6.0...v0.7.0) (2026-11-20)

### Features

* **cli:** `adrien update` checks for the latest version and installs it, only over a copy under npm's global root, and prints the right command for pnpm, yarn and bun ([ef0fa1e](https://github.com/moumine9/adrien/commit/ef0fa1ea9c5b811a91ecf9924d8396935d71f87c))
* **cli:** back up the decision files before `adrien update` installs, then verify them afterwards. `adrien backup create|list|verify|restore` manage the backups under `.adrien/backups`; a restore first takes a snapshot of what it overwrites, so it can be undone, and works when the live config is missing or unusable ([0e41046](https://github.com/moumine9/adrien/commit/0e4104638428616947762e18027bafa65d0e0f08))
* **web:** a Settings page for the theme and the refresh interval, kept in one shared settings store; the old theme key is migrated and tabs stay in sync ([75e36e7](https://github.com/moumine9/adrien/commit/75e36e7a4b3e23f2689cfd712d6652c006e729ce))

### Bug Fixes

* **core:** a lock creation that fails with `EPERM` on Windows is treated as contention instead of an error ([44ce4ad](https://github.com/moumine9/adrien/commit/44ce4ad41c83252dfa56054381576a489e68ed82))
* **core:** the wait for a lock takeover guard is bounded, and removing a guard is best effort ([6a23d70](https://github.com/moumine9/adrien/commit/6a23d7071b9955f32dd583555b958ba9d6cdc021))
* **cli:** `adrien update` starts npm and looks up its global root correctly on Windows ([262e863](https://github.com/moumine9/adrien/commit/262e863d14782a9a76a08efc0f13d65a61623de2), [adea92a](https://github.com/moumine9/adrien/commit/adea92aa2503bbcf2fe902f9ecd24e563b6c644a))

## [0.6.0](https://github.com/moumine9/adrien/compare/v0.5.0...v0.6.0) (2026-11-19)

### Features

* **core:** one writer per ADR. Every change (CLI, MCP, API, editor) takes a lock file per ADR under `.adrien/locks`, so two processes never overwrite each other. A lock left by a crashed process is taken over safely, and `ADR_LOCKED` is returned after `ADRIEN_LOCK_TIMEOUT_MS` ([77ef767](https://github.com/moumine9/adrien/commit/77ef767271954e00eb8242835596ea2bcf2b03a8))
* refuse a change based on a stale read, as a push after the base moved is refused. `adr_get` and `adrien show --json` return a `revision`; `adr_propose_change` needs it as `base_revision` and the CLI takes `--expect`. A stale one fails with `ADR_CONFLICT`: read again, redo the change, retry ([6bc4969](https://github.com/moumine9/adrien/commit/6bc496979e5ac34b14719c6fb904a97cac145b40))

### Bug Fixes

* **core:** locks can no longer be taken over while their holder lets go, and an abandoned takeover guard is never deleted under another process ([28c6ee3](https://github.com/moumine9/adrien/commit/28c6ee3b20a0c0079d1e0bc1d07a1e72f1acb62b))
* **core:** a revision is never newer than the content returned with it, and `accept`, `status` and edits return the revision of the file they wrote ([b007412](https://github.com/moumine9/adrien/commit/b007412afb7e36c8b3e09aaea94307d2eff8e342))
* **core:** `renumber` reserves its new id like `create` and locks the ADRs that refer to the one it moves ([247f308](https://github.com/moumine9/adrien/commit/247f3087c3dc1f6a87c176476cd407c62421cdd6))

## [0.5.0](https://github.com/moumine9/adrien/compare/v0.4.0...v0.5.0) (2026-11-19)

### Features

* **review:** add `adrien review`, a comment for a merge or pull request that lists the recorded decisions governing the files it changes, with each one's review rule. It informs and never blocks (exit code 0), posts nothing and needs no network, so a CI job posts the text and keeps one comment up to date. Recipes for GitHub Actions and GitLab CI are in `docs/ci.md` ([7fc61f9](https://github.com/moumine9/adrien/commit/7fc61f944a2e5457d1305f0998bb951aded2a6b8))
* **web:** the Board shows local edits and deletions on a decision's card and collapses long columns ([f36a19b](https://github.com/moumine9/adrien/commit/f36a19b18c96b67da4d3f678a3011b71bc65f079))
* **docker:** a prebuilt image is published to `ghcr.io/moumine9/adrien` with each release, after the same smoke test that now runs on every Dockerfile change ([e74aa61](https://github.com/moumine9/adrien/commit/e74aa61))

## [0.4.0](https://github.com/moumine9/adrien/compare/v0.3.1...v0.4.0) (2026-11-18)

### Features

* **site:** add a static showcase site with docs and a live demo ([b625c43](https://github.com/moumine9/adrien/commit/b625c4307478d0429430fbd97b9467aa7e1206b7))
* **web:** add a read-only Board view of decisions ([cdea139](https://github.com/moumine9/adrien/commit/cdea139504258a4906baec72190a63406d465036))
* **web:** add the Adrien icon, in the navbar, the favicon and the README ([b10c085](https://github.com/moumine9/adrien/commit/b10c0856fbb889cce8585d7cf6b2fe121a5886f8))

## Earlier releases

These came before the changelog was generated. Later sections are written by `pnpm changelog` at release time.

### 0.3.1

- Core fixes: a cache directory per log URL and a check of its origin, ids reserved across processes, honest
  diagnostics for `check --mr`, `sync` and `check --here`, and ADR reads limited to Markdown files.

### 0.3.0

- Self-hosting: an access token, allowed host names, `/healthz`, `ADRIEN_LOG`, a log that follows its git URL, and a
  Dockerfile.

### 0.2.0

- The read-only local HTTP API, `adrien serve` and the web visualizer.

### 0.1.0

- The first public release: the ADR format, the CLI, the MCP server, `adrien lint` and `adrien export`.
