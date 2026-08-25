/**
 * GET /api/v1/sessions/:id/attachments/:mediaId/content
 *
 * The files a client sent with the booking, stored as a JSON array of WP attachment
 * ids in `wp_kc_appointments.appointment_report`.
 *
 * Two checks, and both are load-bearing:
 *
 * 1. `getSession` throws 403/404 unless the caller may read this session.
 * 2. The media id must actually appear in this session's `appointment_report`.
 *
 * Without (2) any caller holding one legitimate session could walk the media library
 * by incrementing an integer. The failure is 404, not 403 — a 403 would confirm the
 * id exists.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { kcFail, KcError } from '@/lib/kc-response';
import { getSession, SessionServiceError } from '@/services/session/session.service';
import { attachmentBelongsToAppointment, listBookingAttachments } from '@/repositories/wp/encounter-documents.repo';
import { fetchMedia } from '@/lib/wp-endpoint';
import { contentDispositionFor } from '@/lib/http/content-disposition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withAuth(async (_req: NextRequest, ctx) => {
  const { actor, params } = ctx as any;
  try {
    const sessionId = Number(params.id);
    const mediaId = Number(params.mediaId);
    if (!Number.isFinite(sessionId) || !Number.isFinite(mediaId)) {
      return kcFail('Attachment not found', 404);
    }

    // Throws 403/404 when this session is not the caller's to read.
    await getSession(actor, sessionId);

    if (!(await attachmentBelongsToAppointment(sessionId, mediaId))) {
      return kcFail('Attachment not found', 404);
    }

    const attachments = await listBookingAttachments(sessionId);
    const meta = attachments.find((a) => a.mediaId === mediaId);
    if (!meta || meta.missing) {
      return kcFail('Attachment file is no longer available', 404);
    }

    const media = await fetchMedia(mediaId);

    const headers = new Headers({
      'Content-Type': media.contentType,
      'Content-Disposition': contentDispositionFor(media.contentType, meta.filename),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    if (media.contentLength !== null) {
      headers.set('Content-Length', String(media.contentLength));
    }

    return new NextResponse(media.body as any, { status: 200, headers });
  } catch (err) {
    if (err instanceof SessionServiceError) {
      return kcFail(err.message, err.status ?? 403);
    }
    // getSession → resolveKcActor can throw this (e.g. "not linked to a WordPress
    // account", 403) before SessionServiceError ever gets a chance to fire.
    if (err instanceof KcError) {
      return kcFail(err.message, err.httpStatus);
    }
    // eslint-disable-next-line no-console
    console.error('[attachment-content] failed', err);
    return kcFail('Could not read the attachment', 502);
  }
});
