/**
 * Deprecated path — kept so integrations written against `/doctor-sessions` keep working.
 *
 * The resource is `/api/v1/professional-sessions`; this file only re-exports it, so the
 * two paths can never drift. Remove once no client calls the old name.
 */
export { GET } from '../../professional-sessions/module/route';
