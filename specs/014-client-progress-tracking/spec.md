# Feature: Client Progress Tracking

**Input**: Consolidated view of session timeline, notes, intervention plans per client

## Core Artifacts

- spec.md: Aggregated progress dashboard, timeline view, metrics
- plan.md: Data aggregation from Sessions, Notes, Intervention Plans
- tasks.md: Aggregation service, progress dashboard UI
- memory-synthesis.md, checklists/requirements.md

## Key Concept

Reads from features 005 (Sessions), 008 (Notes), 009 (Plans). Produces a read-only aggregated view per client. No new entities.

## Requirements

- FR-03.10: Client progress tracking
- FR-007: Session notes aggregation
- FR-009: Intervention plan aggregation
- Constitution: TDD, Design-Driven