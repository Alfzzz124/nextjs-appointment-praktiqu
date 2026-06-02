# Feature: Email Template Customization

**Input**: Practice admins customize notification email templates

## Core Artifacts

- spec.md: Template management, variable placeholders, preview
- plan.md: Template storage, rendering engine, variable substitution
- tasks.md: Template editor, preview, send test email
- memory-synthesis.md, checklists/requirements.md

## Key Concept

Admin edits templates with variables like {{clientName}}, {{sessionDate}}. System renders at send time. Feature 012 (Notifications) consumes templates.

## Requirements

- US-13.03: Customize email templates
- FR-11.02: Email template customization
- Constitution: Design-Driven, TDD