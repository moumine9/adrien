# Adrien review in CI

`adrien review` writes the comment for a merge request or pull request: the recorded decisions that govern the files it
changes, with each one's `review_rule`. It **informs and never blocks**. It exits `0` whatever it finds, and it posts
nothing. Your pipeline posts the text, and keeps one comment up to date.

The comment starts with the marker `<!-- adrien-review -->`, so a later run can find the comment an earlier run posted
and update it instead of adding another.

```markdown
<!-- adrien-review -->

### Decisions that govern this change

**ADR-0007** Store invoices in Postgres, not in the document store
Rule: Invoices are read and written through the repository, never the document client.
Governs: `billing-service/src/Invoices/store.ts`

Adrien informs, it never blocks. Only accepted decisions on the default branch are binding.
```

Only accepted decisions on the default branch are binding. Everything else, such as proposals and pending changes, is
listed under "Not binding" so a reviewer sees it without it counting as a decision.

## Before you start

- **Full history.** The review compares the branch with the target branch, which needs their shared history. Fetch the
  whole history (`fetch-depth: 0` on GitHub, `GIT_DEPTH: "0"` on GitLab). A shallow clone fails with exit code `2` and
  says which refs it could not compare.
- **The log must be reachable.** The job reads the ADR log, which the code repository finds through its `.adrien.yaml`:

  ```yaml
  log: ../decisions # a checkout next to this repository, or a submodule
  # log: https://gitlab.example.com/acme/decisions # a git URL, cloned once and read-only
  ```

  A path log must exist in the job's checkout. A URL log is cloned into `$ADRIEN_HOME/cache`, so the job needs read
  access to it.

- **Exit codes.** `adrien review` exits `0` for every finding. It exits `2` only when it cannot compare the refs or
  find a default branch, which is a setup problem and not a finding.

## GitHub Actions

Save this as `.github/workflows/adrien-review.yml`. It creates the comment on the first run and edits it afterwards.

```yaml
name: adrien-review

on:
  pull_request:

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Write the review
        env:
          BASE: ${{ github.base_ref }}
        run: npx adrien review --base "origin/$BASE" > review.md
      - name: Create or update the comment
        env:
          GH_TOKEN: ${{ github.token }}
          PR: ${{ github.event.pull_request.number }}
        run: |
          ID=$(gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$PR/comments" \
            --jq '.[] | select(.body | startswith("<!-- adrien-review -->")) | .id' | tail -n 1)
          if [ -n "$ID" ]; then
            gh api --method PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$ID" -F body=@review.md > /dev/null
          else
            gh pr comment "$PR" --body-file review.md
          fi
```

A pull request from a fork gets a read-only token, so the comment step fails there. Add
`if: github.event.pull_request.head.repo.full_name == github.repository` to that step, and the job still writes
`review.md`.

## GitLab CI

Save this in `.gitlab-ci.yml`. It runs in merge request pipelines only.

The job needs a project access token with the `api` scope to write the note. Store it in a **masked** CI/CD variable
named `ADRIEN_REVIEW_TOKEN` (Settings, CI/CD, Variables). It must never be committed to the repository.

```yaml
adrien-review:
  image: node:22
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  variables:
    GIT_DEPTH: "0"
  script:
    - git fetch origin "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
    - npx adrien review --base "origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME" > review.md
    - |
      API="$CI_API_V4_URL/projects/$CI_PROJECT_ID/merge_requests/$CI_MERGE_REQUEST_IID/notes"
      NOTE_ID=$(curl --silent --fail --header "PRIVATE-TOKEN: $ADRIEN_REVIEW_TOKEN" "$API?per_page=100" |
        node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
          const ids = JSON.parse(s).filter((n) => n.body.startsWith("<!-- adrien-review -->")).map((n) => n.id);
          process.stdout.write(String(ids.pop() ?? ""));
        });')
      if [ -n "$NOTE_ID" ]; then
        curl --silent --fail --request PUT --header "PRIVATE-TOKEN: $ADRIEN_REVIEW_TOKEN" \
          --data-urlencode "body@review.md" "$API/$NOTE_ID" > /dev/null
      else
        curl --silent --fail --request POST --header "PRIVATE-TOKEN: $ADRIEN_REVIEW_TOKEN" \
          --data-urlencode "body@review.md" "$API" > /dev/null
      fi
```

## Keep it informational

Do not make the review job a required check. It informs and never blocks, so a merge never waits on it. If the job fails
it is a setup problem, such as a shallow clone or an unreachable log, and the fix is to repair the job.

## Try it locally

```sh
npx adrien review --base origin/main          # what this branch changes
npx adrien review --files src/Invoices/a.ts   # specific files, relative to the current directory
npx adrien review --json                      # counts, markdown and each file's decisions, for scripts
```
