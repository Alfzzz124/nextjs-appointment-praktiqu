#!/usr/bin/env tsx
/**
 * Generate the OpenAPI spec for `/api/v1` from the Zod schemas that already validate
 * those routes at runtime.
 *
 * Why this exists: `docs/api/openapi.yaml` claims in its header to be "generated from
 * route files", but no generator existed — it was produced once and hand-maintained,
 * so it drifted. It still described client ids as cuid strings after they became
 * numeric `wp_users.ID`. A spec nobody can regenerate is a spec that lies.
 *
 * Migration strategy: this owns one route group at a time. Registered groups are
 * REPLACED in the spec on every run; groups not yet registered are left untouched, so
 * the hand-maintained remainder shrinks as groups are added rather than needing a
 * 187-route rewrite up front.
 *
 *   npm run openapi          # rewrite the owned groups in docs/api/openapi.yaml
 *   npm run openapi -- --check   # fail if the file is stale (for CI)
 *
 * Uses @asteasolutions/zod-to-openapi v7, which peers on zod 3 (v9 requires zod 4).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import yaml from 'js-yaml';

extendZodWithOpenApi(z);

import {
  clientDetailResponseSchema,
  clientListResponseSchema,
  clientStatisticsSchema,
  clientStatusSchema,
  createClientSchema,
  listClientsQuerySchema,
  updateClientSchema,
  updateStatusSchema,
} from '../src/services/client/validation';

const SPEC_PATH = resolve(process.cwd(), 'docs/api/openapi.yaml');
const CHECK_ONLY = process.argv.includes('--check');

/** Route-path prefixes this generator owns. Everything else is left alone. */
const OWNED_PREFIXES = ['/api/v1/clients'];

const registry = new OpenAPIRegistry();

const bearer = registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

/**
 * A client id is a WordPress user id. This is the parameter that silently went stale:
 * it was documented as a string long after the implementation moved to wp_users.
 */
const clientIdParam = z
  .coerce.number()
  .int()
  .positive()
  .openapi({ param: { name: 'id', in: 'path' }, example: 17 });

const problem = {
  description: 'RFC-7807 problem detail',
  content: {
    'application/problem+json': {
      schema: z.object({
        type: z.string(),
        title: z.string(),
        status: z.number().int(),
        detail: z.string().optional(),
      }),
    },
  },
};

const auth = [{ [bearer.name]: [] }];

registry.registerPath({
  method: 'get',
  path: '/api/v1/clients',
  tags: ['clients'],
  summary: 'List clients',
  description:
    'Patients from `wp_users` carrying the `kiviCare_patient` capability. Scoped to the ' +
    "actor's clinic unless the actor is a SUPER_ADMIN.",
  security: auth,
  request: { query: listClientsQuerySchema },
  responses: {
    200: {
      description: 'Paginated clients',
      content: { 'application/json': { schema: clientListResponseSchema } },
    },
    401: problem,
    403: problem,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/clients',
  tags: ['clients'],
  summary: 'Register a client',
  description:
    'Creates a WordPress user with the `kiviCare_patient` capability via the ' +
    'praktiqu-endpoint plugin, so KiviCare\'s `kc_patient_save` listeners fire and the ' +
    'welcome email is sent.',
  security: auth,
  request: {
    body: { content: { 'application/json': { schema: createClientSchema } }, required: true },
  },
  responses: {
    201: {
      description: 'Created',
      content: { 'application/json': { schema: clientDetailResponseSchema } },
    },
    400: problem,
    401: problem,
    403: problem,
    409: { ...problem, description: 'Email already registered' },
    422: problem,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/clients/{id}',
  tags: ['clients'],
  summary: 'Get a client',
  security: auth,
  request: { params: z.object({ id: clientIdParam }) },
  responses: {
    200: {
      description: 'The client',
      content: { 'application/json': { schema: clientDetailResponseSchema } },
    },
    400: { ...problem, description: 'Non-numeric client id' },
    401: problem,
    403: problem,
    404: problem,
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/clients/{id}',
  tags: ['clients'],
  summary: 'Update a client',
  description: 'Editable fields depend on the actor role; unpermitted fields return 403.',
  security: auth,
  request: {
    params: z.object({ id: clientIdParam }),
    body: { content: { 'application/json': { schema: updateClientSchema } }, required: true },
  },
  responses: {
    200: {
      description: 'Updated',
      content: { 'application/json': { schema: clientDetailResponseSchema } },
    },
    400: problem,
    401: problem,
    403: problem,
    404: problem,
    422: problem,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/clients/{id}',
  tags: ['clients'],
  summary: 'Archive a client',
  description: 'Soft delete. The client must already be INACTIVE.',
  security: auth,
  request: { params: z.object({ id: clientIdParam }) },
  responses: {
    200: {
      description: 'Archived',
      content: { 'application/json': { schema: clientDetailResponseSchema } },
    },
    400: { ...problem, description: 'Invalid status transition' },
    401: problem,
    403: problem,
    404: problem,
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/clients/{id}/status',
  tags: ['clients'],
  summary: 'Change client status',
  description: 'SUPER_ADMIN or CLINIC_ADMIN only.',
  security: auth,
  request: {
    params: z.object({ id: clientIdParam }),
    body: { content: { 'application/json': { schema: updateStatusSchema } }, required: true },
  },
  responses: {
    200: {
      description: 'Updated',
      content: { 'application/json': { schema: clientDetailResponseSchema } },
    },
    400: { ...problem, description: 'Invalid status transition' },
    401: problem,
    403: problem,
    404: problem,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/clients/{id}/statistics',
  tags: ['clients'],
  summary: 'Client session statistics',
  description: 'Counts the client’s KiviCare appointments.',
  security: auth,
  request: { params: z.object({ id: clientIdParam }) },
  responses: {
    200: {
      description: 'Statistics',
      content: { 'application/json': { schema: z.object({ data: clientStatisticsSchema }) } },
    },
    400: problem,
    401: problem,
    403: problem,
    404: problem,
  },
});

const bulkIds = z
  .array(z.coerce.number().int().positive())
  .min(1)
  .describe('WordPress user ids');

registry.registerPath({
  method: 'post',
  path: '/api/v1/clients/bulk/delete',
  tags: ['clients'],
  summary: 'Bulk archive clients',
  security: auth,
  request: {
    body: {
      content: { 'application/json': { schema: z.object({ ids: bulkIds }) } },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'How many were archived',
      content: { 'application/json': { schema: z.object({ count: z.number().int() }) } },
    },
    401: problem,
    403: problem,
    422: problem,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/clients/bulk/status',
  tags: ['clients'],
  summary: 'Bulk set client status',
  security: auth,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ ids: bulkIds, status: clientStatusSchema }),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'How many were updated',
      content: { 'application/json': { schema: z.object({ count: z.number().int() }) } },
    },
    401: problem,
    403: problem,
    422: problem,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/clients/export',
  tags: ['clients'],
  summary: 'Export clients',
  security: auth,
  request: {
    query: z.object({
      clinicId: z.coerce.number().int().positive().optional(),
      status: clientStatusSchema.optional(),
    }),
  },
  responses: {
    200: {
      description: 'All matching clients',
      content: { 'application/json': { schema: z.object({ data: z.array(clientListResponseSchema.shape.data.element) }) } },
    },
    401: problem,
    403: problem,
  },
});

/**
 * The remaining three routes in this group. They are registered even though nothing
 * about them changed, because this generator DELETES every `/api/v1/clients*` path
 * before re-adding — so a route left unregistered would silently disappear from the
 * spec. Owning a prefix means owning all of it.
 */

registry.registerPath({
  method: 'get',
  path: '/api/v1/clients/{id}/custom-fields',
  tags: ['clients'],
  summary: 'Get a client’s custom field values',
  security: auth,
  request: { params: z.object({ id: clientIdParam }) },
  responses: {
    200: {
      description: 'Field definitions with their values',
      content: {
        'application/json': {
          schema: z.object({
            items: z.array(
              z.object({
                fieldId: z.union([z.string(), z.number()]),
                label: z.string().optional(),
                type: z.string().optional(),
                value: z.unknown().nullable(),
              }),
            ),
          }),
        },
      },
    },
    401: problem,
    404: problem,
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/v1/clients/{id}/custom-fields',
  tags: ['clients'],
  summary: 'Set a client’s custom field values',
  security: auth,
  request: {
    params: z.object({ id: clientIdParam }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            values: z.array(
              z.object({ fieldId: z.union([z.string(), z.number()]), value: z.unknown() }),
            ),
          }),
        },
      },
      required: true,
    },
  },
  responses: {
    200: { description: 'Saved', content: { 'application/json': { schema: z.object({}).passthrough() } } },
    401: problem,
    404: problem,
    422: problem,
  },
});

for (const path of [
  '/api/v1/clients/{id}/resend-credentials',
  '/api/v1/clients/bulk/resend-credentials',
] as const) {
  registry.registerPath({
    method: 'post',
    path,
    tags: ['clients'],
    summary: 'Resend client credentials',
    // Documented as it actually behaves: both handlers return 501 unconditionally.
    description: 'Not implemented — the handler returns 501.',
    security: auth,
    ...(path.includes('{id}') ? { request: { params: z.object({ id: clientIdParam }) } } : {}),
    responses: { 501: { ...problem, description: 'Not implemented' } },
  });
}

/* ------------------------------------------------------------------ */
/* Merge into the existing spec                                        */
/* ------------------------------------------------------------------ */

type Spec = {
  paths?: Record<string, unknown>;
  components?: { schemas?: Record<string, unknown>; securitySchemes?: Record<string, unknown> };
  [k: string]: unknown;
};

const generated = new OpenApiGeneratorV3(registry.definitions).generateComponents() as Spec;
const generatedPaths = new OpenApiGeneratorV3(registry.definitions).generateDocument({
  openapi: '3.0.3',
  info: { title: 'tmp', version: '1' },
}).paths as Record<string, unknown>;

const existing = yaml.load(readFileSync(SPEC_PATH, 'utf8')) as Spec;
const before = yaml.dump(existing, { lineWidth: 110, noRefs: true, sortKeys: false });

existing.paths ??= {};

/**
 * Drop every owned path before re-adding, so a route we delete in code disappears from
 * the spec instead of lingering forever.
 */
for (const path of Object.keys(existing.paths)) {
  if (OWNED_PREFIXES.some((p) => path === p || path.startsWith(p + '/'))) {
    delete existing.paths[path];
  }
}
Object.assign(existing.paths, generatedPaths);

existing.components ??= {};
existing.components.schemas = { ...existing.components.schemas, ...generated.components?.schemas };

// Keep paths in a stable order so diffs stay readable.
existing.paths = Object.fromEntries(
  Object.entries(existing.paths).sort(([a], [b]) => a.localeCompare(b)),
);

const after = yaml.dump(existing, { lineWidth: 110, noRefs: true, sortKeys: false });

if (CHECK_ONLY) {
  if (before !== after) {
    console.error(
      '\x1b[31m✖ docs/api/openapi.yaml is stale.\x1b[0m Run `npm run openapi` and commit the result.',
    );
    process.exit(1);
  }
  console.log('\x1b[32m✔ openapi.yaml is up to date.\x1b[0m');
  process.exit(0);
}

writeFileSync(SPEC_PATH, after);
console.log(
  `\x1b[32m✔\x1b[0m Regenerated ${Object.keys(generatedPaths).length} paths ` +
    `(${OWNED_PREFIXES.join(', ')}) in docs/api/openapi.yaml`,
);
