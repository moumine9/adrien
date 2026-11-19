# Releasing

Only the `adrien` package (`packages/cli`) is published. Releases are tagged `vX.Y.Z` and published by the release
workflow, with provenance, when the tag is pushed.

`main` is protected: every change, a release included, goes through a pull request with the four `test` checks green.

## Steps

1. Branch from an up-to-date `main`: `git switch -c release/X.Y.Z`.
2. Set the new version in `packages/cli/package.json`.
3. Run `pnpm changelog`. It adds a section for the version at the top of `CHANGELOG.md`, from the
   [Conventional Commits](https://www.conventionalcommits.org) since the last `v*` tag. Read it, and edit the wording
   if a line would not mean much to someone who has not seen the commit. `pnpm changelog --stdout` previews it.
4. Commit with `chore(release): X.Y.Z`, push, and open the pull request.
5. Merge it once the checks pass.
6. Fetch, then tag the merge commit on `main` and push the tag:
   `git fetch origin && git tag vX.Y.Z origin/main && git push origin vX.Y.Z`. Without the fetch, `origin/main` is still the
   commit before the merge, and the release workflow rejects a tag that does not match the package version.
7. Check that the release workflow succeeded and that `npm view adrien version` shows the new version. The workflow also
   creates the GitHub Release, with that version's `CHANGELOG.md` entry as its notes.

## The changelog rule

A version cannot be merged or released without a `CHANGELOG.md` entry for it. `pnpm changelog:check` fails when the
version in `packages/cli/package.json` has no heading in `CHANGELOG.md`, or when that entry is empty. CI runs it on
every push and pull request, and the release workflow runs it again before publishing.

## Which commits appear

Commits of type `feat`, `fix`, `perf` and `revert` become entries (Features, Bug Fixes, Performance Improvements,
Reverts). `docs`, `test`, `ci`, `build`, `chore`, `style` and `refactor` do not. A commit with a `!` after the type, or a
`BREAKING CHANGE:` footer, is listed under a breaking-changes heading and means a major version.

Write the commit subject for a reader of the changelog: it is copied there as it is.
