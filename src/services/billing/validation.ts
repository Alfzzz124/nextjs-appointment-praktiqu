import { z } from 'zod';

// Accept ints, {value}, or {id} shapes KiviCare sends; normalize to number[].
const idList = z
  .array(z.union([z.number(), z.string(), z.object({ value: z.any() }).passthrough(), z.object({ id: z.any() }).passthrough()]))
  .optional()
  .transform((arr) =>
    (arr ?? [])
      .map((x) => (typeof x === 'object' && x !== null ? (x as any).value ?? (x as any).id : x))
      .map((x) => parseInt(String(x), 10))
      .filter((n) => Number.isFinite(n)),
  );

export const taxListQuerySchema = z.object({
  id: z.coerce.number().int().optional(),
  taxName: z.string().optional(),
  status: z.coerce.number().int().optional(),
  clinic: z.coerce.number().int().optional(),
  doctor: idList,
  service: idList,
  orderby: z.string().optional(),
  order: z.enum(['asc', 'desc', 'ASC', 'DESC']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.union([z.coerce.number().int(), z.literal('all')]).default(10),
});

export const taxCreateSchema = z.object({
  name: z.string().optional().default(''),
  rateType: z.enum(['percentage', 'fixed']).default('percentage'),
  rateValue: z.coerce.number().refine((n) => n > 0, 'rateValue must be > 0'),
  clinic: z.coerce.number().int().default(-1),
  doctor: idList,
  service: idList,
  status: z.coerce.number().int().min(0).max(1).default(1),
  addedBy: z.coerce.number().int().optional(),
});

export const taxUpdateSchema = taxCreateSchema.partial().extend({
  rateValue: z.coerce.number().refine((n) => n > 0, 'rateValue must be > 0').optional(),
});

export const statusSchema = z.object({ status: z.coerce.number().int().min(0).max(1) });
export const idsSchema = z.object({ ids: z.array(z.coerce.number().int()).min(1) });
export const idsStatusSchema = idsSchema.merge(statusSchema);

export const billListQuerySchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.union([z.coerce.number().int(), z.literal('all')]).default(10),
  orderBy: z.string().optional(),
  order: z.enum(['asc', 'desc', 'ASC', 'DESC']).optional(),
  id: z.coerce.number().int().optional(),
  encounter_id: z.coerce.number().int().optional(),
  doctorName: z.string().optional(),
  clinicName: z.string().optional(),
  patientName: z.string().optional(),
  serviceName: z.string().optional(),
});

const serviceItemSchema = z.object({
  serviceId: z.coerce.number().int().optional(),
  id: z.coerce.number().int().optional(),
  name: z.string().optional(),
  service_name: z.string().optional(),
  quantity: z.coerce.number().int().optional(),
  qty: z.coerce.number().int().optional(),
  price: z.coerce.number().optional(),
});

const taxItemSchema = z.object({
  id: z.coerce.number().int().optional(),
  tax_name: z.string().optional(),
  tax_type: z.enum(['percentage', 'fixed']).optional(),
  tax_value: z.coerce.number().optional(),
  tax_amount: z.coerce.number().optional(),
});

const refObj = z.object({ id: z.coerce.number().int(), appointmentId: z.coerce.number().int().optional() });

export const billCreateSchema = z.object({
  serviceItems: z.array(serviceItemSchema).min(1),
  taxItems: z.array(taxItemSchema).optional().default([]),
  discount: z.coerce.number().optional().default(0),
  discountEnabled: z.coerce.boolean().optional().default(false),
  status: z.enum(['paid', 'unpaid']),
  clinic: refObj,
  doctor: refObj,
  patient: refObj,
  patientEncounter: refObj,
  service_total: z.coerce.number(),
  total_amount: z.coerce.number(),
  checkout: z.coerce.boolean().optional(),
});

export const billUpdateSchema = billCreateSchema;

export const billItemUpdateSchema = z.object({
  serviceId: z.coerce.number().int(),
  quantity: z.coerce.number().int().min(1),
  price: z.coerce.number(),
});

export const calculateTaxSchema = z.object({
  clinic_id: z.coerce.number().int().optional(),
  doctor_id: z.coerce.number().int().optional(),
  serviceItems: z.array(serviceItemSchema).min(1),
});

export const encounterListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.union([z.coerce.number().int().min(1).max(100), z.literal('all')]).default(10),
  patientId: z.coerce.number().int().optional(),
  doctorId: z.coerce.number().int().optional(),
  clinicId: z.coerce.number().int().optional(),
  status: z.coerce.number().int().min(0).max(1).optional(),
  dateFrom: z.string().optional(),   // YYYY-MM-DD
  dateTo: z.string().optional(),     // YYYY-MM-DD
});

export const encounterCreateSchema = z.object({
  patientId: z.coerce.number().int(),
  appointmentId: z.coerce.number().int().optional(),
  clinicId: z.coerce.number().int().optional(),   // admins may set; else derived from actor
  doctorId: z.coerce.number().int().optional(),   // admins may set; else derived from actor
  encounterDate: z.string().optional(),           // YYYY-MM-DD; default today
  description: z.string().max(5000).optional(),
  templateId: z.coerce.number().int().optional(),
});

export const encounterUpdateSchema = z.object({
  description: z.string().max(5000).optional(),
  encounterDate: z.string().optional(),
  status: z.coerce.number().int().min(0).max(1).optional(),
}).strict();
