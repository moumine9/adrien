## [0.8.0](https://github.com/moumine9/adrien/compare/v0.7.0...v0.8.0) (2026-11-22)

### Features

* **api:** return each ADR's revision and when it was last modified ([b4d8b19](https://github.com/moumine9/adrien/commit/b4d8b195a6bea7825f2f4606894f3c0e2cda7a0e))
* **web:** add the change notifications setting ([1523a54](https://github.com/moumine9/adrien/commit/1523a54ea2d8ef0700c3eecd49410efa928ec723))
* **web:** draw decisions in a frame that matches their binding state ([54a114d](https://github.com/moumine9/adrien/commit/54a114dcde6918dde9917a7fafbb73047e394019))
* **web:** explain decision authority on the detail page ([d9d8c87](https://github.com/moumine9/adrien/commit/d9d8c87719dc1c9ab1a6f6dadedc28ecf2f54b81))
* **web:** format ADR detail pages for printing ([21ce4a2](https://github.com/moumine9/adrien/commit/21ce4a2f7d868e5d5db6962d2f3735c00e370d13))
* **web:** say when the open decision is out of date, and reload it only on request ([8042853](https://github.com/moumine9/adrien/commit/8042853c3086072f00f997df4b0346aeb356c2b2))
* **web:** show each decision's revision and when it changed, with a Show revision setting ([18545b5](https://github.com/moumine9/adrien/commit/18545b50e3dc9931aaf822e838cb249ef02e10d6))
* **web:** tell the reader when decisions change while the page is open ([0acd7c2](https://github.com/moumine9/adrien/commit/0acd7c24b356ab685a30cc8f9ce236ac667fc54f))

### Bug Fixes

* **api:** date an unchanged ADR by this checkout, not by the default branch ([0af2ce8](https://github.com/moumine9/adrien/commit/0af2ce84acccb85efeba1da91008ee6839ab2e4e))
* **core:** date an ADR settled in a merge conflict by that merge ([0b062e5](https://github.com/moumine9/adrien/commit/0b062e564e45841bf4de5dd326791807f9ea1f49))
* **web:** date a reading of the list by when its request was sent, not when the answer arrived ([0064732](https://github.com/moumine9/adrien/commit/00647324b2966aba259978964dba4b2d8e5f3874))
* **web:** follow every poll of the list, and keep the send times of the unfiltered list only ([0d2a7d1](https://github.com/moumine9/adrien/commit/0d2a7d19ff05a1239aac63b7b2e6f5c84533cf9c))
* **web:** give the demo API valid revisions, and none for a deleted decision ([e5ec66f](https://github.com/moumine9/adrien/commit/e5ec66f235070a3a22beb64af4a727a0865c002f))
* **web:** keep the change notice honest: merge, hold on hover or focus, and honour the setting ([c72905f](https://github.com/moumine9/adrien/commit/c72905f2cd587cba07d4958e5c4f1a7a7ca4de08))
* **web:** keep the open decision from changing without Reload, and from being called out of date by an older reading ([a493b93](https://github.com/moumine9/adrien/commit/a493b93060089db754c1c4870ebe353a0ff9e3e0))
* **web:** pause the change notice for hover and focus separately, and clear it when notifications go off ([f4026b6](https://github.com/moumine9/adrien/commit/f4026b61c4883566a49e64c90f2a1deb3b6e6124))

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
