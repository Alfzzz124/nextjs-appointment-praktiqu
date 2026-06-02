# Feature: Informed Consent

**Input**: Consent form creation, sending for signature, signing, viewing consent status

## Core Artifacts

- spec.md: Consent form creation, sending, signing workflow, status tracking
- plan.md: Consent models (ConsentForm, ConsentSignature), sending mechanism, signature capture
- tasks.md: Form builder, signature API, status tracking
- memory-synthesis.md, checklists/requirements.md, contracts/

## Requirements

- FR-01: Clinic Admin creates consent form with content
- FR-02: Professional sends consent for signature to client
- FR-03: Client signs consent digitally (electronic signature)
- FR-04: Consent status viewable by professional
- FR-05: Consent withdrawal capability
- Constitution: Design-Driven, TDD, Audit logging