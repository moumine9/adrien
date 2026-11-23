# Releasing

Only the `adrien` package (`packages/cli`) is published. Releases are tagged `vX.Y.Z` and published by the release
workflow, with provenance, when the tag is pushed.

`main` is protected: every change, a release included, goes through a pull request with the four `test` checks and the `e2e` check green.

## Steps

`pnpm release` (`scripts/release.mjs`) runs the mechanical steps. It never pushes a branch, merges or publishes without
being asked. Each step shows the manual commands it replaces.

1. Prepare the release branch from an up-to-date `main`: `pnpm release prepare X.Y.Z`. It refuses unless `X.Y.Z` is a
   plain version greater than the one in `packages/cli/package.json`, the working tree is clean, and `HEAD` equals
   `origin/main` after a fetch. It then creates the branch `release/X.Y.Z`, sets the version, runs `pnpm changelog` and
   commits `chore(release): X.Y.Z`. Manually: `git switch -c release/X.Y.Z`, set the new version in
   `packages/cli/package.json`, run `pnpm changelog`, then commit `packages/cli/package.json` and `CHANGELOG.md`.
   `pnpm changelog` adds a section for the version at the top of `CHANGELOG.md`, from the
   [Conventional Commits](https://www.conventionalcommits.org) since the last `v*` tag. `pnpm changelog --stdout`
   previews it.
2. Read the new `CHANGELOG.md` entry, and edit the wording if a line would not mean much to someone who has not seen the
   commit. Commit the edit on the release branch.
3. Push the branch and open the pull request: `git push -u origin release/X.Y.Z`, then open it against `main`. The
   checks are the four `test` checks and the `e2e` check.
4. Merge it once Codex approves and the checks pass.
5. Fetch and tag the merge commit on `main`: `pnpm release tag`. It refuses unless `origin/main` has the same version in
   `packages/cli/package.json`, `origin/main:CHANGELOG.md` has an entry for it, and no `vX.Y.Z` tag exists locally or on
   origin. It creates `vX.Y.Z` on `origin/main` and prints `git push origin vX.Y.Z`. Pushing the tag publishes, so run
   that push yourself, or run `pnpm release tag --push` instead of `pnpm release tag` to tag and push in one step. Manually: `git fetch origin && git tag vX.Y.Z origin/main &&
   git push origin vX.Y.Z`. Without the fetch, `origin/main` is still the commit before the merge, and the release
   workflow rejects a tag that does not match the package version.
6. Check the release: `pnpm release verify`. It prints `npm view adrien version` and `gh release view vX.Y.Z`, and fails
   while npm does not show the new version yet. The release workflow publishes the package with provenance and creates
   the GitHub Release, with that version's `CHANGELOG.md` entry as its notes. Manually: `npm view adrien version` and
   `gh release view vX.Y.Z --json tagName,url`.

## The changelog rule

A version cannot be merged or released without a `CHANGELOG.md` entry for it. `pnpm changelog:check` fails when the
version in `packages/cli/package.json` has no heading in `CHANGELOG.md`, or when that entry is empty. CI runs it on
every push and pull request, and the release workflow runs it again before publishing.

## Which commits appear

Commits of type `feat`, `fix`, `perf` and `revert` become entries (Features, Bug Fixes, Performance Improvements,
Reverts). `docs`, `test`, `ci`, `build`, `chore`, `style` and `refactor` do not. A commit with a `!` after the type, or a
`BREAKING CHANGE:` footer, is listed under a breaking-changes heading and means a major version.

Write the commit subject for a reader of the changelog: it is copied there as it is.
