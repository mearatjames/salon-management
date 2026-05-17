# Specification Quality Checklist: Per-service deductions + two-pane services layout

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-05-17
**Feature**: [spec.md](../spec.md)

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

- All items pass on the first review pass. The spec consciously reuses 008
  patterns (drawer → two-pane is the only structural change; field set is
  additive), reuses the existing `audit_log` schema unchanged, and pins
  the Phase 1 / Phase 2 / Phase 3 boundary explicitly so out-of-scope work
  is unambiguous.
- The spec names the existing files the feature MUST extend
  (`_validation.ts`, `actions.ts`, `components/lacquer/services/*`) and
  the design reference (`design-system/ServicesV1.jsx` — V1 only) as
  reuse constraints, not implementation prescriptions — they exist
  today, the spec just asserts they MUST be reused.
- `card_fee_mode` is described as "enum / text with CHECK constraint" in
  FR-031 to leave the column type choice (PostgreSQL enum vs. text + CHECK)
  to the planning phase. Both satisfy the constraint shape.
- The "hardcoded $3" constant is called out as a single named constant so
  the Phase 2 cutover is a one-line change, and the segmented control
  label + list-row chip + Net-to-tech preview all source it from the same
  place (FR-011, FR-015, FR-026).
