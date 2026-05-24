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

- [x] No [NEEDS CLARIFICATION] markers remain  *(All 3 clarifications resolved in session 2026-05-24: split-tender scope, discount granularity, orphan-Order disposition.)*
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

- All three clarifying questions resolved in `/speckit-clarify` session 2026-05-24; answers are logged at the top of `spec.md` under `## Clarifications` and the requirements have been updated in place.
- The spec keeps implementation details (Orders API, line-item field names, idempotency hash details) out of the user-facing sections; those live in the issue and will be re-introduced in the plan stage.
- "Tax behaviour" is captured as a hard requirement (FR-005) rather than a clarification — the totals-match-exactly contract leaves no product decision to make.
- Square SDK terminology (`applied_discounts`, `discount_target_line_ids`, `amountMoney`, `terminal.checkouts.create`) is used sparingly in FR-003, FR-008, and the edge-case list where the precise data-model attachment point is the requirement; the rest of the spec speaks in user-facing language.
