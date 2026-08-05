/**
 * Informed consent — forms and signatures.
 *
 * The tables stay: consent is a PraktiQU concept with no KiviCare equivalent. What
 * changed is what `practiceId` points at. It used to reference the `clinics` shadow
 * table's cuid; it now carries `wp_kc_clinics.id` as text, and the service checks the
 * clinic exists before creating a form for it. See
 * docs/architecture/shadow-tables-audit.md.
 *
 * `clientId` still references `users.id`, the auth mirror, because ConsentSignature has
 * a real foreign key to it. That mirror row resolves to a WordPress patient through
 * `users.wpUserId`; repointing the column is a schema change, not a code one.
 */
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { findClinicById } from '@/repositories/wp/clinics.repo';

/** `wp_kc_clinics.id`, carried as text in a String column. */
const practiceIdSchema = z.string().regex(/^\d+$/, 'practiceId must be a numeric clinic id');

export const consentFormCreateSchema = z.object({
  practiceId: practiceIdSchema,
  name: z.string().min(1).max(255),
  content: z.string().min(1),
});

export class ConsentServiceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'ConsentServiceError';
  }
}

export const consentFormUpdateSchema = consentFormCreateSchema.partial();

export const consentSignatureSchema = z.object({
  formId: z.string().min(1),
  clientId: z.string().min(1),
  signatureSvg: z.string().optional(),
  signatureText: z.string().optional(),
  declineReason: z.string().optional(),
  status: z.enum(['SIGNED', 'DECLINED']),
});

export type ConsentFormCreate = z.infer<typeof consentFormCreateSchema>;
export type ConsentFormUpdate = z.infer<typeof consentFormUpdateSchema>;
export type ConsentSignatureInput = z.infer<typeof consentSignatureSchema>;

export class ConsentService {
  constructor(private prisma: PrismaClient) {}

  async listForms(practiceId: string, status?: string) {
    return this.prisma.consentForm.findMany({
      where: { practiceId, ...(status ? { status: status as any } : {}) },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getForm(id: string) {
    return this.prisma.consentForm.findUnique({
      where: { id },
      include: { signatures: true },
    });
  }

  async createForm(data: ConsentFormCreate) {
    const parsed = consentFormCreateSchema.parse(data);

    // Checked rather than assumed: a form filed against a clinic that does not exist is
    // invisible to every list query, which scopes by practice.
    const clinic = await findClinicById(BigInt(parsed.practiceId));
    if (!clinic) {
      throw new ConsentServiceError('No clinic with that id', 404, 'practice_not_found');
    }

    return this.prisma.consentForm.create({
      data: {
        practiceId: parsed.practiceId,
        name: parsed.name,
        content: parsed.content,
      },
    });
  }

  async updateForm(id: string, data: ConsentFormUpdate) {
    return this.prisma.consentForm.update({
      where: { id },
      data: consentFormUpdateSchema.parse(data),
    });
  }

  async sendSignatureRequest(formId: string, clientId: string) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    return this.prisma.consentSignature.create({
      data: {
        formId,
        clientId,
        status: 'PENDING',
        expiresAt,
      },
    });
  }

  async sign(formId: string, clientId: string, input: Omit<ConsentSignatureInput, 'formId' | 'clientId'>) {
    const parsed = consentSignatureSchema.parse({ ...input, formId, clientId });
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    return this.prisma.consentSignature.upsert({
      where: { formId_clientId: { formId, clientId } },
      create: {
        formId,
        clientId,
        status: parsed.status,
        signatureSvg: parsed.signatureSvg,
        signatureText: parsed.signatureText,
        declineReason: parsed.declineReason,
        signedAt: new Date(),
        expiresAt, // required column; same 30-day window as sendSignatureRequest
        ipAddress: undefined, // injected from middleware
        userAgent: undefined,
      },
      update: {
        status: parsed.status,
        signatureSvg: parsed.signatureSvg,
        signatureText: parsed.signatureText,
        declineReason: parsed.declineReason,
        signedAt: parsed.status === 'SIGNED' ? new Date() : undefined,
      },
    });
  }

  async getSignatureStatus(formId: string, clientId: string) {
    return this.prisma.consentSignature.findUnique({
      where: { formId_clientId: { formId, clientId } },
    });
  }

  async withdraw(formId: string, clientId: string) {
    return this.prisma.consentSignature.update({
      where: { formId_clientId: { formId, clientId } },
      data: { withdrawnAt: new Date(), status: 'WITHDRAWN' as any },
    });
  }

  async deleteForm(id: string): Promise<void> {
    const existing = await this.prisma.consentForm.findUnique({ where: { id } });
    if (!existing) throw Object.assign(new Error('not_found'), { code: 'not_found' });
    await this.prisma.consentForm.delete({ where: { id } });
  }

  async bulkSetConsentFormStatus(ids: string[], status: string): Promise<number> {
    const result = await this.prisma.consentForm.updateMany({
      where: { id: { in: ids } },
      data: { status: status as any },
    });
    return result.count;
  }
}