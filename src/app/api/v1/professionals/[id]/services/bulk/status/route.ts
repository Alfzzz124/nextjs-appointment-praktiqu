/**
 * POST /api/v1/professionals/[id]/services/bulk/status — RETIRED, answers 410.
 *
 * Bulk status change wrote to `wp_kc_service_doctor_mapping` without the upcoming-appointment check
 * that `/api/v1/services` enforces, and without a clinic filter. See
 * `src/services/professional/retired-endpoints.ts` for the full reasoning and the
 * removal date.
 *
 * No auth check: the endpoint is gone for everyone, so who is asking does not change the
 * answer. A 401 first would imply a better token might work.
 */
import { bulkStatusRetired } from '@/services/professional/retired-endpoints';

export const POST = async () => bulkStatusRetired();
