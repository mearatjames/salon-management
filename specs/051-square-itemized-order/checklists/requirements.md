# Specification Quality Checklist: Itemized Square Terminal Checkout

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-05-24
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [ ] No [NEEDS CLARIFICATION] markers remain  *(2 open clarification questions: Q1 split-tender Order scope, Q2 discount granularity — both awaiting user choice)*
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Two clarifying questions remain open in the spec under `## Requirements → Clarifications` (Q1 and Q2). The user needs to pick from the suggested answers (or provide custom answers) before `/speckit-clarify` or `/speckit-plan`.
- The spec keeps implementation details (Orders API, line-item field names, idempotency hash details) out of the user-facing sections; those live in the issue and will be re-introduced in the plan stage.
- Square SDK terminology ("Orders API", "applied_discounts", "OrderLineItem") appears only inside the Q1/Q2 clarification context blocks so the user can make an informed product decision; the rest of the spec speaks in user-facing language.
- "Tax behaviour" is captured as a hard requirement (FR-005) rather than a clarification — the totals-match-exactly contract leaves no product decision to make.
