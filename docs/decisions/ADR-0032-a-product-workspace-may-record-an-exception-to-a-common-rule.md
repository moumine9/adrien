---
id: ADR-0032
title: A product workspace may record an exception to a common rule, with a reason and a review date
status: proposed
date: 2026-11-23
review_on: 2027-05-23
tags: [format, workflow]
components: [core, api, cli]
review_rule: A product workspace may depart from a common rule only through its own accepted decision that names the common decision, gives the reason and sets a review date; without such a decision the common rule binds.
related: [ADR-0031, ADR-0030, ADR-0023]
origin: agent

---

## Context

ADR-0031 lets one Adrien instance serve several workspaces, one per product, plus a common workspace whose accepted decisions bind every product. It says a product workspace "may not contradict a common one". The owner's reason for workspaces is that each product has different standards, so a rule that is right for most products can be wrong for one. With the strict rule, the only way out is to change the common rule for everyone, or to leave the common workspace. A product that cannot depart from a common rule, even once, with a recorded reason, either works around the rule silently or stops using the common workspace.

## Considered options

- Keep the strict rule of ADR-0031: a product may never contradict a common rule.
- Let a product workspace override a common rule freely, by writing its own contradicting decision.
- Let a product workspace record an exception: its own accepted decision that names the common decision, gives the reason, and carries a review date. Without one, the common rule binds.

## Decision

This ADR proposes to supersede ADR-0031: when it is accepted, ADR-0031 is marked superseded by it and the link is added, in the same change. Until then ADR-0031 stands as accepted. Everything in ADR-0031 stays as it was (workspaces, the common workspace, ids and names across workspaces, roles per workspace, one token for a self-hosted instance) except the sentence that a product workspace may not contradict a common rule. It is replaced by the following.

A common rule binds every product workspace unless that workspace has recorded an **exception**. An exception is an ordinary decision in the product workspace, with its own status and approval by merge, that names the common decision it departs from by its full name (such as `common/ADR-0004`), gives the reason, and sets a `review_on` date. A proposed exception does not exempt anything: only an accepted one does. It exempts that one workspace from that one common decision, and nothing else; the common rule itself is not changed and still binds every other product.

The exception is visible. A product workspace shows it next to the common decision, and the common decision shows which workspaces hold an exception. When the review date passes, the exception is reported as due for review like any other decision (ADR-0016), and the common rule binds again in the reader's eye until someone renews or removes it. A check may inform about these cases, and never blocks (ADR-0006).

Who may approve an exception: the maintainers of the product workspace, by merging it there, as for any decision of that workspace. This ADR does not give the maintainers of the common workspace a veto. If an organisation wants one, it uses git host rules on the product repository, or a later ADR.

## Rationale

A recorded exception keeps what the strict rule protects, which is that a common rule means something, and adds what it lacked: a product with a good reason can say so in a form that is reviewed, dated, and visible to everyone who relies on the rule. A free override would make the common workspace advice at best, and would hide departures. Leaving approval to the product's maintainers matches ADR-0031's idea that a workspace is a log with its own people and its own merges, and keeps the common workspace from becoming a gate on every product.

## Consequences

ADR-0031 becomes superseded when this ADR is accepted. The format needs a way to name the decision an exception departs from, and the checks, the API and the web app need to show exceptions on both sides; how, is left to the implementation, and to a later ADR if it changes the file format. A common rule is weaker than before: a product can depart from it without the common maintainers agreeing, so an organisation that needs more must add a veto of its own. An exception that is never reviewed stays in force, since only the date shows that it is stale. An exception can itself be superseded or deprecated like any decision.
