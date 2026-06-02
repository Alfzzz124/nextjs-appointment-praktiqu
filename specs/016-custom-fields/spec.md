# Feature: Custom Fields

**Input**: Dynamic form fields for client/professional/service records

## Core Artifacts

- spec.md: Field definition, field types, validation rules
- plan.md: CustomField model, field rendering
- tasks.md: Field builder UI, field rendering in forms
- memory-synthesis.md, checklists/requirements.md

## Key Concept

Admin defines custom fields (text/number/date/select). Fields render in forms. Values stored as JSON on existing entities.

## Requirements

- FR-15.01: Dynamic form fields
- Constitution: TDD, Design-Driven