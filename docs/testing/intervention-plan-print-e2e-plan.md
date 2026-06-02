# E2E Test Plan: Intervention Plan Print

## Scope
Validation of the print-friendly intervention plan view and PDF download flow.

## Pre-conditions
- Authenticated user with PROFESSIONAL role
- At least one existing intervention plan with ≥1 recommendation

## Scenarios

### S1: Open print view
1. Navigate to `/intervention-plans/{id}/print`
2. **Expected**: Layout renders A4-friendly; client/professional/clinic visible; recommendations grouped by status

### S2: Browser print
1. Click "Print" button
2. **Expected**: Browser print dialog opens; only main content shows (button hidden via @media print)

### S3: PDF download
1. Use browser "Save as PDF"
2. **Expected**: PDF file downloads with proper page size, branding color applied

### S4: HTML escaping
- Plan title with `<script>` tag must render as escaped text

## CI integration
Use Playwright/agent-browser in headless mode; assert key DOM nodes; capture PDF and store under `artifacts/`.
