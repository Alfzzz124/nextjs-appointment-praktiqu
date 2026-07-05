/**
 * Clinic-scoped invoice number generator.
 *
 * Format: `INV-{clinicCode}-{YYYY}-{NNNNN}` (zero-padded 5-digit sequence).
 *
 * Sequence is per-clinic, per-year; resets at year boundary.
 *
 * Atomicity: implemented as a `Bill.billNumber` UNIQUE constraint plus a
 * monotonic counter (`Clinic.billSequence`) incremented inside a Prisma
 * transaction. On UNIQUE collision (race), the caller retries up to
 * `MAX_ATTEMPTS` times.
 *
 * Source of truth: specs/011-billing/spec.md (Q: How is the invoice numbered?)
 */

import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';

export const MAX_ATTEMPTS = 5;
const SEQUENCE_PAD = 5;

export class InvoiceNumberError extends Error {
  constructor(
    public readonly code:
      | 'invalid_clinic_code'
      | 'clinic_not_found'
      | 'no_clinic_code'
      | 'retry_exhausted'
      | 'transaction_aborted',
    message?: string
  ) {
    super(message ?? code);
    this.name = 'InvoiceNumberError';
  }
}

export interface GenerateOptions {
  tx?: PrismaClient | Prisma.TransactionClient;
  now?: Date;
}

export interface GenerateResult {
  billNumber: string;
  clinicId: string;
  clinicCode: string;
  year: number;
  sequence: number;
  attempts: number;
}

/** Validate a clinic code: 2-4 alphanumeric chars. */
export function isValidClinicCode(code: string | null | undefined): code is string {
  return !!code && /^[A-Za-z0-9]{2,4}$/.test(code);
}

/**
 * Generate the next invoice number for a clinic. Wraps the increment + lookup
 * in a transaction so two concurrent calls can't read the same counter.
 *
 * @throws InvoiceNumberError
 */
export async function generateInvoiceNumber(
  clinicId: string,
  opts: GenerateOptions = {}
): Promise<GenerateResult> {
  const client = (opts.tx ?? prisma) as PrismaClient;
  const now = opts.now ?? new Date();
  const year = now.getUTCFullYear();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await runOneAttempt(client, clinicId, year, attempt);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err.code === 'P2002' || // unique violation
          err.code === 'P2034') // transaction conflict
      ) {
        // Retry on race
        if (attempt === MAX_ATTEMPTS) {
          throw new InvoiceNumberError(
            'retry_exhausted',
            `Failed to allocate invoice number after ${MAX_ATTEMPTS} attempts`
          );
        }
        continue;
      }
      throw err;
    }
  }
  // unreachable
  throw new InvoiceNumberError('retry_exhausted');
}

async function runOneAttempt(
  client: PrismaClient,
  clinicId: string,
  year: number,
  attempt: number
): Promise<GenerateResult> {
  // Use a serializable transaction to guarantee monotonic counter reads.
  return client.$transaction(
    async (tx) => {
      const clinic = await tx.clinic.findUnique({
        where: { id: clinicId },
        select: { id: true, code: true, billSequence: true, billSequenceYear: true },
      });
      if (!clinic) {
        throw new InvoiceNumberError('clinic_not_found', `Clinic ${clinicId} not found`);
      }
      if (!clinic.code || !isValidClinicCode(clinic.code)) {
        throw new InvoiceNumberError(
          'no_clinic_code',
          `Clinic ${clinicId} has no valid code (got ${JSON.stringify(clinic.code)})`
        );
      }

      // Year rollover
      const isNewYear = clinic.billSequenceYear !== year;
      const nextSeq = isNewYear ? 1 : (clinic.billSequence ?? 0) + 1;

      await tx.clinic.update({
        where: { id: clinicId },
        data: {
          billSequence: nextSeq,
          billSequenceYear: year,
        },
      });

      const billNumber = formatInvoiceNumber(clinic.code, year, nextSeq);

      return {
        billNumber,
        clinicId: clinic.id,
        clinicCode: clinic.code,
        year,
        sequence: nextSeq,
        attempts: attempt,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

export function formatInvoiceNumber(clinicCode: string, year: number, sequence: number): string {
  if (!isValidClinicCode(clinicCode)) {
    throw new InvoiceNumberError('invalid_clinic_code', `Invalid clinic code: ${clinicCode}`);
  }
  return `INV-${clinicCode.toUpperCase()}-${year}-${String(sequence).padStart(SEQUENCE_PAD, '0')}`;
}

export const invoiceNumber = {
  generate: generateInvoiceNumber,
  format: formatInvoiceNumber,
  isValidClinicCode,
  MAX_ATTEMPTS,
};
