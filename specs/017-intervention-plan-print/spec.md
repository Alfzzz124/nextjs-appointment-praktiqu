# Feature Specification: Intervention Plan Print

**Feature Branch**: `017-intervention-plan-print`

**Created**: 2026-06-02

**Status**: Draft

**Input**: "Print intervention plan as formatted document"

## User Scenarios

### Print Intervention Plan (Priority: P2)

A Professional needs to print a client's intervention plan as a formatted document.

**Why this priority**: Printing supports client handover and record keeping.

**Independent Test**: Professional clicks Print on an intervention plan → formatted print view opens.

**Acceptance Scenarios**:

1. **Given** a Professional views an intervention plan, **When** they click Print, **Then** a formatted print view opens with client name, plan date, activities, and instructions.

## Requirements

- **FR-001**: System MUST display a print-optimized view of intervention plan content.
- **FR-002**: Print view includes: client name, professional name, date, activity list.
- **FR-003**: Print uses browser print CSS (no server-side PDF generation).

## Assumptions

- Browser print CSS handles formatting. No server-side PDF generation.
- Print view is read-only.