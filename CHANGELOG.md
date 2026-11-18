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
