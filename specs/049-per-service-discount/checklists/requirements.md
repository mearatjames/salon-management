# Specification Quality Checklist: Per-service discount in checkout

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-05-22
**Feature**: [Link to spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
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

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`.
- One topic the team may want to revisit at `/speckit-clarify`: the payroll/commission stance.
  The spec assumes "per-service discounts do not reduce the responsible technician's commission base" (matches today's behavior for transaction-wide discounts). If the salon owner wants discounts to come out of the technician's pay rather than the salon's revenue, that flips an assumption and may add a P2 requirement.
- A second topic for `/speckit-clarify`: whether scoped discounts and an "all services" discount should compound multiplicatively (current spec, FR-009: scoped first, then all-services on the remainder) or add nominally (sum both reductions, then apply once). Both yield the same total for additive cases; the difference is observable when an "all services" percent discount is combined with a scoped percent discount.
