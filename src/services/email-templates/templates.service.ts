/**
 * Email-template persistence service.
 *
 * Wraps Prisma's `emailTemplate` model with a stable, typed API used by
 * the API routes (T004) and the email-send worker in feature 012.
 *
 * Source of truth: specs/018-email-templates/plan.md
 * Prisma model:   prisma/schema.prisma (`email_templates` table)
 *
 * Note: the Prisma column for the body is `body` (TEXT). We store the
 * HTML in that column and the plain-text body in the `bodyText` JSON
 * field, alongside the declared variable list.
 */

import { prisma } from '@/lib/db';
import { Prisma, type PrismaClient } from '@prisma/client';

/** Union type accepted by all service functions so they work inside or outside a transaction. */
type TxClient = PrismaClient;
import { extractPlaceholders, renderTemplate } from '@/services/email-templates/preview.service';
import type {
  CreateEmailTemplateInput,
  EmailTemplateDTO,
  PreviewEmailTemplateInput,
  RenderedTemplate,
  UpdateEmailTemplateInput,
  VariableContext,
} from '@/types/email-template';

/** JSON shape persisted in the `variables` column. */
interface TemplateMetadata {
  bodyText: string;
  variables: string[];
  fromName: string | null;
  replyTo: string | null;
}

function rowToDTO(row: TemplateRow): EmailTemplateDTO {
  const meta = (row.variables ?? {}) as Partial<TemplateMetadata>;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description ?? null,
    subject: row.subject,
    bodyHtml: row.body,
    bodyText: meta.bodyText ?? '',
    fromName: meta.fromName ?? null,
    replyTo: meta.replyTo ?? null,
    variables: meta.variables ?? [],
    status: row.status === 1 ? 'active' : 'inactive',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Narrow type for the EmailTemplate row (avoids Prisma's heavy GetPayload
// generic when just reading fields from findUnique/findMany).
type TemplateRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  subject: string;
  body: string;
  variables: unknown;
  status: number;
  createdAt: Date;
  updatedAt: Date;
};

export class EmailTemplateNotFoundError extends Error {
  constructor(public readonly identifier: string) {
    super(`Email template not found: ${identifier}`);
    this.name = 'EmailTemplateNotFoundError';
  }
}

export class EmailTemplateConflictError extends Error {
  constructor(public readonly key: string) {
    super(`Email template with key already exists: ${key}`);
    this.name = 'EmailTemplateConflictError';
  }
}

function buildMetadata(input: {
  bodyText: string;
  variables: string[];
  fromName?: string | null;
  replyTo?: string | null;
}): TemplateMetadata {
  return {
    bodyText: input.bodyText,
    variables: input.variables,
    fromName: input.fromName ?? null,
    replyTo: input.replyTo ?? null,
  };
}

function prismaOrTx(tx?: TxClient): TxClient {
  return tx ?? prisma;
}

// ============================================================
// CRUD
// ============================================================

export async function listTemplates(
  options: { includeInactive?: boolean } = {},
  tx?: TxClient,
): Promise<EmailTemplateDTO[]> {
  const client = prismaOrTx(tx);
  const where = options.includeInactive ? {} : { status: 1 };
  const rows = await client.emailTemplate.findMany({
    where,
    orderBy: { key: 'asc' },
  });
  return rows.map(rowToDTO);
}

export async function getTemplateById(
  id: string,
  tx?: TxClient,
): Promise<EmailTemplateDTO> {
  const client = prismaOrTx(tx);
  const row = await client.emailTemplate.findUnique({ where: { id } });
  if (!row) throw new EmailTemplateNotFoundError(id);
  return rowToDTO(row);
}

export async function getTemplateByKey(
  key: string,
  tx?: TxClient,
): Promise<EmailTemplateDTO> {
  const client = prismaOrTx(tx);
  const row = await client.emailTemplate.findUnique({ where: { key } });
  if (!row) throw new EmailTemplateNotFoundError(key);
  return rowToDTO(row);
}

export async function createTemplate(
  input: CreateEmailTemplateInput,
  tx?: TxClient,
): Promise<EmailTemplateDTO> {
  const client = prismaOrTx(tx);
  // If the caller didn't list variables explicitly, derive them from the
  // HTML and text bodies so the editor can show them in the UI.
  const variables =
    input.variables.length > 0
      ? input.variables
      : Array.from(
          new Set([
            ...extractPlaceholders(input.subject),
            ...extractPlaceholders(input.bodyHtml),
            ...extractPlaceholders(input.bodyText),
          ]),
        ).sort();

  try {
    const row = await client.emailTemplate.create({
      data: {
        key: input.key,
        name: input.name,
        description: input.description ?? null,
        subject: input.subject,
        body: input.bodyHtml,
        variables: buildMetadata({
          bodyText: input.bodyText,
          variables,
          fromName: input.fromName ?? null,
          replyTo: input.replyTo ?? null,
        }) as unknown as Prisma.InputJsonValue,
        status: input.status === 'active' ? 1 : 0,
        type: 'email',
      },
    });
    return rowToDTO(row);
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002'
    ) {
      throw new EmailTemplateConflictError(input.key);
    }
    throw err;
  }
}

export async function updateTemplate(
  id: string,
  input: UpdateEmailTemplateInput,
  tx?: TxClient,
): Promise<EmailTemplateDTO> {
  const client = prismaOrTx(tx);
  const existing = await client.emailTemplate.findUnique({ where: { id } });
  if (!existing) throw new EmailTemplateNotFoundError(id);

  const existingMeta = (existing.variables ?? {}) as Partial<TemplateMetadata>;
  const mergedMeta: TemplateMetadata = {
    bodyText: input.bodyText ?? existingMeta.bodyText ?? '',
    variables:
      input.variables ??
      (existingMeta.variables as string[] | undefined) ??
      [],
    fromName:
      input.fromName === undefined
        ? (existingMeta.fromName ?? null)
        : (input.fromName ?? null),
    replyTo:
      input.replyTo === undefined
        ? (existingMeta.replyTo ?? null)
        : (input.replyTo ?? null),
  };

  const row = await client.emailTemplate.update({
    where: { id },
    data: {
      subject: input.subject ?? undefined,
      body: input.bodyHtml ?? undefined,
      variables: mergedMeta as unknown as Prisma.InputJsonValue,
      status:
        input.status === undefined ? undefined : input.status === 'active' ? 1 : 0,
    },
  });
  return rowToDTO(row);
}

export async function deleteTemplate(
  id: string,
  tx?: TxClient,
): Promise<void> {
  const client = prismaOrTx(tx);
  try {
    await client.emailTemplate.delete({ where: { id } });
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: string }).code === 'P2025'
    ) {
      throw new EmailTemplateNotFoundError(id);
    }
    throw err;
  }
}

// ============================================================
// Preview / Render
// ============================================================

/**
 * Render a template (existing or hypothetical) with the given variables.
 * Used by the preview endpoint and the email-send worker.
 */
export function preview(
  dto: Pick<EmailTemplateDTO, 'subject' | 'bodyHtml' | 'bodyText' | 'fromName' | 'replyTo'>,
  input: PreviewEmailTemplateInput,
): RenderedTemplate {
  return renderTemplate(
    {
      subject: dto.subject,
      bodyHtml: dto.bodyHtml,
      bodyText: dto.bodyText,
      fromName: dto.fromName,
      replyTo: dto.replyTo,
    },
    input.variables as VariableContext,
    {
      subject: input.subject,
      bodyHtml: input.bodyHtml,
      bodyText: input.bodyText,
      fromName: input.fromName === undefined ? null : input.fromName,
      replyTo: input.replyTo === undefined ? null : input.replyTo,
    },
  );
}
