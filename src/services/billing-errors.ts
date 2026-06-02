/**
 * RFC 7807 Problem Details helpers for the billing feature.
 *
 * Source of truth: .specify/memory/constitution.md §API Standards.
 *
 * Reused from 001-auth-foundation; this file is the billing-specific extension
 * of error codes. The runtime shape is:
 *   { type, title, status, detail, instance, code?, [extensions...] }
 */

import { NextResponse } from 'next/server';

export const BillingErrorCode = {
  DISCOUNT_EXCEEDS_SUBTOTAL: 'discount_exceeds_subtotal',
  BILL_ALREADY_PAID: 'bill_already_paid',
  CANNOT_VOID_PAID_BILL: 'cannot_void_paid_bill',
  CONCURRENT_MODIFICATION: 'concurrent_modification',
  BILL_NOT_FOUND: 'bill_not_found',
  BILL_NOT_EDITABLE: 'bill_not_EDITABLE'.toLowerCase(),
  INVALID_BILL_STATUS: 'invalid_bill_status',
  REFUND_EXCEEDS_PAYMENT: 'refund_exceeds_payment',
  REFUND_ON_UNPAID_BILL: 'refund_on_unpaid_bill',
  OVERPAYMENT: 'overpayment',
  EMPTY_BILL: 'empty_bill',
  INVOICE_NUMBER_COLLISION: 'invoice_number_collision',
  CLINIC_NOT_FOUND: 'clinic_not_found',
  CROSS_PRACTICE_FORBIDDEN: 'cross_practice_forbidden',
  INSUFFICIENT_PERMISSIONS: 'insufficient_permissions',
  PAYMENT_PROVIDER_ERROR: 'payment_provider_error',
  WEBHOOK_SIGNATURE_INVALID: 'webhook_signature_invalid',
  VALIDATION_FAILED: 'validation_failed',
  IDEMPOTENCY_KEY_REUSED: 'idempotency_key_reused',
  ALREADY_VOIDED: 'already_voided',
  TAX_NEGATIVE: 'tax_negative',
  LINE_ITEM_NOT_FOUND: 'line_item_not_found',
} as const;

export type BillingErrorCodeValue = (typeof BillingErrorCode)[keyof typeof BillingErrorCode];

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code?: BillingErrorCodeValue | string;
  [extension: string]: unknown;
}

const TYPE_BASE = '/errors/billing';

const TITLES: Record<string, { title: string; status: number }> = {
  [BillingErrorCode.DISCOUNT_EXCEEDS_SUBTOTAL]: { title: 'Discount Exceeds Subtotal', status: 400 },
  [BillingErrorCode.BILL_ALREADY_PAID]: { title: 'Bill Already Paid', status: 409 },
  [BillingErrorCode.CANNOT_VOID_PAID_BILL]: { title: 'Cannot Void Paid Bill', status: 409 },
  [BillingErrorCode.CONCURRENT_MODIFICATION]: { title: 'Concurrent Modification', status: 409 },
  [BillingErrorCode.BILL_NOT_FOUND]: { title: 'Bill Not Found', status: 404 },
  [BillingErrorCode.BILL_NOT_EDITABLE]: { title: 'Bill Not Editable', status: 409 },
  [BillingErrorCode.INVALID_BILL_STATUS]: { title: 'Invalid Bill Status', status: 409 },
  [BillingErrorCode.REFUND_EXCEEDS_PAYMENT]: { title: 'Refund Exceeds Payment', status: 400 },
  [BillingErrorCode.REFUND_ON_UNPAID_BILL]: { title: 'Refund On Unpaid Bill', status: 400 },
  [BillingErrorCode.OVERPAYMENT]: { title: 'Overpayment', status: 400 },
  [BillingErrorCode.EMPTY_BILL]: { title: 'Empty Bill', status: 400 },
  [BillingErrorCode.INVOICE_NUMBER_COLLISION]: { title: 'Invoice Number Collision', status: 409 },
  [BillingErrorCode.CLINIC_NOT_FOUND]: { title: 'Clinic Not Found', status: 404 },
  [BillingErrorCode.CROSS_PRACTICE_FORBIDDEN]: { title: 'Cross-Practice Forbidden', status: 404 },
  [BillingErrorCode.INSUFFICIENT_PERMISSIONS]: { title: 'Insufficient Permissions', status: 403 },
  [BillingErrorCode.PAYMENT_PROVIDER_ERROR]: { title: 'Payment Provider Error', status: 502 },
  [BillingErrorCode.WEBHOOK_SIGNATURE_INVALID]: { title: 'Invalid Webhook Signature', status: 401 },
  [BillingErrorCode.VALIDATION_FAILED]: { title: 'Validation Failed', status: 400 },
  [BillingErrorCode.IDEMPOTENCY_KEY_REUSED]: { title: 'Idempotency Key Reused', status: 409 },
  [BillingErrorCode.ALREADY_VOIDED]: { title: 'Bill Already Voided', status: 409 },
  [BillingErrorCode.TAX_NEGATIVE]: { title: 'Tax Cannot Be Negative', status: 400 },
  [BillingErrorCode.LINE_ITEM_NOT_FOUND]: { title: 'Line Item Not Found', status: 404 },
};

export class BillingError extends Error {
  public readonly code: BillingErrorCodeValue | string;
  public readonly status: number;
  public readonly type: string;
  public readonly title: string;
  public readonly extensions: Record<string, unknown>;

  constructor(
    code: BillingErrorCodeValue | string,
    detail?: string,
    extensions: Record<string, unknown> = {}
  ) {
    const meta = TITLES[code] ?? { title: code, status: 500 };
    super(detail ?? meta.title);
    this.name = 'BillingError';
    this.code = code;
    this.status = meta.status;
    this.type = `${TYPE_BASE}/${code}`;
    this.title = meta.title;
    this.extensions = extensions;
  }

  toProblem(instance?: string): ProblemDetails {
    return {
      type: this.type,
      title: this.title,
      status: this.status,
      detail: this.message,
      instance,
      code: this.code,
      ...this.extensions,
    };
  }

  toResponse(instance?: string): NextResponse {
    return NextResponse.json(this.toProblem(instance), { status: this.status });
  }
}

export function problemResponse(
  code: BillingErrorCodeValue | string,
  detail?: string,
  instance?: string,
  extensions: Record<string, unknown> = {}
): NextResponse {
  return new BillingError(code, detail, extensions).toResponse(instance);
}

export { BillingErrorCode as BillingErrorCodes };
