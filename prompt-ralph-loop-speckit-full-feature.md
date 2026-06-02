# Full Feature Specification Generation Loop

Objective:

Generate complete specifications, plans, tasks, and analysis for all remaining features in the project using the Speckit workflow.

The Authentication & Authorization feature has already been completed and should be treated as the foundation for all subsequent features.

---

# Source of Truth

Before starting any feature:

1. Read and understand:
   - docs/PRD.md
   - docs/00_US-index.md
   - Constitution
   - docs/01_FR-index.md
   - docs/02_BRD-index.md
   - Existing implementation decisions

2. Treat the PRD as the primary source of truth.

3. Do not introduce new business requirements unless explicitly required by the PRD.

4. Avoid over-engineering.

5. Prefer the simplest architecture that satisfies the PRD.

6. Reuse existing domain concepts whenever possible.

7. Respect decisions already made in previous specifications.

---

# Feature Progress Tracker

Global progress checklist:

- [ ] Professional Management
- [ ] Service Management
- [ ] Client Management
- [ ] Session Management
- [ ] Dashboard
- [ ] Public Booking Portal
- [ ] Session Notes
- [ ] Intervention Plan
- [ ] Informed Consent
- [ ] Billing
- [ ] Notifications
- [ ] Practice Management
- [ ] Client Progress Tracking
- [ ] Session Notes Templates
- [ ] Custom Fields
- [ ] Intervention Plan Print
- [ ] Email Template Customization

Update this checklist after each feature is successfully completed.

---

# Feature Processing Rules

Process only ONE feature at a time.

Before starting a feature:

1. Read current progress.
2. Select the first unfinished feature.
3. Reset the Feature Quality Checklist completely.
4. Execute the entire workflow for the selected feature.
5. Complete all validations.
6. Mark the feature as completed in the Global Progress Tracker.
7. Move to the next unfinished feature.

Never process multiple features simultaneously.

Never skip features.

Do not change feature order unless a hard dependency requires it.

---

# Feature Order

Process features sequentially in the following order:

1. Professional Management
2. Service Management
3. Client Management
4. Session Management
5. Dashboard
6. Public Booking Portal
7. Session Notes
8. Intervention Plan
9. Informed Consent
10. Billing
11. Notifications
12. Practice Management
13. Client Progress Tracking
14. Session Notes Templates
15. Custom Fields
16. Intervention Plan Print
17. Email Template Customization

---

# Workflow Per Feature

For every feature execute the following workflow.

## Step 1 — Specification

Launch a sub-agent.

Run:

- speckit-specify

Requirements:

- Follow PRD strictly.
- Follow User Stories strictly.
- Follow Constitution strictly.
- Respect existing architecture decisions.
- Reuse previously defined entities and concepts.
- Avoid duplicate entities.
- Avoid duplicate business processes.
- Keep scope limited to the current feature.
- Do not implement future-phase functionality.

---

## Step 2 — Clarification

Launch a sub-agent.

Run:

- speckit-clarify

Requirements:

- Resolve ambiguities.
- Validate assumptions against PRD.
- Remove unnecessary complexity.
- Remove unnecessary requirements.
- Prevent scope creep.
- Prefer explicit decisions whenever possible.
- Ensure feature remains implementable.

---

## Step 3 — Planning

Launch a sub-agent.

Run:

- speckit-plan

Requirements:

- Follow project architecture.
- Follow API standards.
- Follow authentication standards.
- Follow authorization standards.
- Follow logging standards.
- Respect previously completed feature specifications.
- Respect existing domain model.

---

## Step 4 — Task Generation

Launch a sub-agent.

Run:

- speckit-tasks

Requirements:

- Generate implementation-ready tasks.
- Tasks must be actionable.
- Tasks must be logically ordered.
- Tasks must not be excessively large.
- Tasks must not be excessively fragmented.
- Dependencies must be clearly identified.

---

## Step 5 — Analysis & Validation

Launch a sub-agent.

Run:

- speckit-analyze

Additional validation requirements:

Review generated outputs against:

- PRD
- User Stories
- Constitution
- Existing Specifications
- Existing Architecture Decisions

Verify:

- No over-engineering
- No scope creep
- No duplicated functionality
- No duplicated entities
- No conflicting terminology
- No missing PRD requirements
- No conflicting architecture decisions
- No unnecessary infrastructure complexity
- No premature optimization

If issues are found:

- Fix the issues.
- Re-run analysis.
- Repeat until validation passes.

---

# Feature Quality Checklist

IMPORTANT:

This checklist MUST be reset to unchecked state before processing every new feature.

When a feature is completed and the next feature begins, all checklist items below must be treated as unchecked again.

Validation Checklist:

- [ ] Specification created
- [ ] Clarification completed
- [ ] Plan completed
- [ ] Tasks completed
- [ ] Analysis completed

PRD Validation:

- [ ] All PRD requirements covered
- [ ] All related User Stories covered
- [ ] No PRD requirements omitted
- [ ] No requirements invented

Architecture Validation:

- [ ] Compatible with Constitution
- [ ] Compatible with established API standards
- [ ] Compatible with Authentication architecture
- [ ] Compatible with Authorization architecture
- [ ] Compatible with Logging standards
- [ ] Compatible with Deployment assumptions

Consistency Validation:

- [ ] Consistent with previous feature specifications
- [ ] No duplicated business logic
- [ ] No duplicated entities
- [ ] No conflicting terminology
- [ ] Reuses existing domain concepts where appropriate

Complexity Validation:

- [ ] No over-engineering
- [ ] No premature optimization
- [ ] No unnecessary abstractions
- [ ] No unnecessary infrastructure requirements
- [ ] Scope limited to current feature

Task Validation:

- [ ] Tasks are implementation-ready
- [ ] Tasks are properly sequenced
- [ ] Tasks are not too large
- [ ] Tasks are not excessively fragmented
- [ ] Dependencies identified

Readiness Validation:

- [ ] Feature ready for implementation
- [ ] Feature ready for code generation
- [ ] Feature ready for review

Every item above must be checked before a feature can be marked complete.

---

# Architecture Constraints

Always respect the following established decisions.

## Authentication

- WordPress remains the Identity Provider.
- Next.js remains the primary business application.
- JWT Bearer Authentication.
- Google Login support.
- RBAC authorization.
- Service-level authorization.

## API Standards

- REST API.
- RFC 7807 Problem Details.
- URL path versioning.
- Page-based pagination with metadata.

## Logging

- Structured database logging.
- AUDIT logging.
- PERF logging.
- Email-based critical alerting.
- Short retention strategy.

## Monitoring

- Basic health monitoring.
- Detailed health endpoint.
- Deferred APM implementation.
- No vendor lock-in assumptions.

## Deployment

- Deployment target is not finalized.
- Must remain compatible with:
  - Vercel
  - Shared Hosting
  - VPS

Avoid infrastructure-specific decisions unless required by the PRD.

---

# Feature Completion Gate

Before marking a feature complete:

1. Verify all Feature Quality Checklist items are checked.
2. Verify no unresolved questions remain.
3. Verify all generated artifacts exist.
4. Verify analysis reports no critical issues.
5. Verify the feature aligns with the PRD.
6. Verify the feature aligns with the Constitution.
7. Verify the feature aligns with User Stories.

Only after all checks pass:

- Mark the feature as complete in the Global Progress Tracker.
- Reset the Feature Quality Checklist.
- Continue to the next unfinished feature.

---

# Failure Handling

If a workflow step fails:

1. Investigate the cause.
2. Retry the step.
3. Correct any discovered issues.
4. Continue only after successful completion.

Do not silently skip failed steps.

Do not mark incomplete work as completed.

---

# Final Completion Criteria

All features listed in the Global Progress Tracker must be completed.

For every feature:

- Specification generated
- Clarification completed
- Plan completed
- Tasks completed
- Analysis completed
- Validation passed

When ALL features are completed and ALL validations pass, output exactly:

DONE
