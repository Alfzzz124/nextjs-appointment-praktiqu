// src/services/consent/service.ts
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';

export const consentFormCreateSchema = z.object({
  practiceId: z.string().min(1),
  name: z.string().min(1).max(255),
  content: z.string().min(1),
});

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
    return this.prisma.consentForm.create({ data: consentFormCreateSchema.parse(data) });
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
}