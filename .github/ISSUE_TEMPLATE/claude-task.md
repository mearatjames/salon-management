---
name: Claude Task
about: A self-contained task for the Claude agent loop to implement overnight.
title: ""
labels: ["agent-queue"]
assignees: []
---

<!--
This issue will be picked up by the local agent loop (scripts/agent-loop.md).
When the loop labels it `agent-ready`, the Claude Code GitHub Action will
implement it on a branch and open a PR.

The tighter and more concrete this issue is, the better the first-shot PR.
Fill in every section. If a section truly doesn't apply, write "n/a" —
don't delete it.
-->

## Goal

<!-- One paragraph. What outcome does this task produce? Why does it matter
for the salon? Avoid implementation details here — those go below. -->

## Acceptance criteria

<!-- A bulleted checklist a reviewer (or Claude) can tick off. Each item
must be objectively verifiable. Numbers, file paths, and exact copy are
better than vague descriptions. -->

- [ ]
- [ ]
- [ ]

## Files & areas

<!-- Where in the codebase does this likely live? Naming the directories or
files prevents Claude from wandering. If it touches a feature spec, link
specs/<NNN-feature>/spec.md. -->

-

## Out of scope

<!-- What should the PR explicitly NOT do? This is how you keep PR diffs
small. Examples: "don't refactor adjacent components", "don't bump
dependencies", "don't change the schema". -->

-

## Verification

<!-- How does Claude prove it works? Default: run the full gate set
(format:check, lint, typecheck, test, test:e2e). Add anything extra —
manual browser smoke tests, screenshots, specific Playwright specs to
prove green. -->

- [ ] `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e` all green
- [ ]

## Design system check (UI only)

<!-- Delete this section if the task touches no UI. -->

- [ ] Every value (color, spacing, radius, shadow) traces to a token in `styles/tokens.css`
- [ ] Compared side-by-side with the matching prototype in `design-system/`
- [ ] Lucide icons only, Inter font only, tabular numerals on numeric columns
