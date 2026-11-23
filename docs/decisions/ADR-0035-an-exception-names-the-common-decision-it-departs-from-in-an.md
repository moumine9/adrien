---
id: ADR-0035
title: An exception names the common decision it departs from in an exception_to field
status: proposed
date: 2026-11-23
review_on: 2027-05-23
tags: [format]
components: [core]
code: [core:src/check.ts]
review_rule: A product decision departs from a common one only through an accepted decision whose exception_to field names it as workspace/ADR-n and that carries a review_on date; the exemption is limited to the files of its code anchors when it has any.
related: [ADR-0032, ADR-0034]
origin: agent
---

## Context

ADR-0032 lets a product workspace depart from a common rule through its own accepted decision that names the common one, gives a reason and carries a review date. It leaves the file format open: which field names the common decision, how far the exemption reaches, and what `adrien check` says about it.

## Considered options

- Reuse `related`, and recognise an exception by the words in its text.
- A dedicated field in the exception's frontmatter that names the common decision.
- Record exceptions in the product's configuration, apart from the decisions.

## Decision

A decision of a product workspace is an exception when its frontmatter has `exception_to`: a list of references to common decisions, written `workspace/ADR-n` as in ADR-0034. An exception exempts its workspace from the decisions it names, and only once its status is `accepted`; a proposed exception exempts nothing. The reason is the decision's own text, and the field `review_on` is required.

The exemption covers the whole workspace, unless the exception has `code` anchors, in which case it covers only the files they match. It never changes the common decision: other products stay bound by it.

`adrien check` reports an exception without `review_on` as a warning, and a reference in `exception_to` that is not a decision of a reachable log as a broken link, an error like a dangling `related` (ADR-0034); an unreachable log is reported as information. When the review date passes, the existing review-due report applies (ADR-0016) and the exception stays in force until it is renewed, replaced or removed. These reports follow ADR-0006: only errors, or warnings under `--strict`, change the exit code.

Where decisions are shown, a product shows its exceptions next to the common decision they depart from, and a common decision shows the workspaces that hold an exception, derived from the product side and never written into the common log. An exception can be superseded or deprecated like any decision, and then exempts nothing.

## Rationale

A field in the exception's own frontmatter keeps the exception a decision like the others: it has a status, a text, a review date, and goes through the same merge. A convention based on words would be fragile and invisible to tools. Keeping exceptions out of the configuration would hide them from the people who read the decisions. Limiting the exemption with the exception's own `code` anchors uses a mechanism that already exists, and lets a product depart from a common rule for one component without leaving it everywhere.

## Consequences

The format gains a field and `adrien check` gains two warnings, with their documentation. The tools that say which decisions govern a file must apply exceptions, so that an exempted common decision is shown as exempted for those files rather than hidden. An exception that is never reviewed stays in force, and only its date shows that it is stale. Older versions reject the new field. How the viewer shows exceptions is left to the implementation.
