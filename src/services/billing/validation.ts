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

export const prescriptionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.union([z.coerce.number().int().min(1).max(100), z.literal('all')]).default(10),
  patientId: z.coerce.number().int().optional(),
  encounterId: z.coerce.number().int().optional(),
  search: z.string().optional(),  // matches prescription.name
});
export const prescriptionCreateSchema = z.object({
  encounterId: z.coerce.number().int(),
  patientId: z.coerce.number().int(),
  name: z.string().min(1).max(2000),
  frequency: z.string().max(199).optional(),
  duration: z.string().max(199).optional(),
  instruction: z.string().max(5000).optional(),
});
export const prescriptionUpdateSchema = z.object({
  name: z.string().min(1).max(2000).optional(),
  frequency: z.string().max(199).optional(),
  duration: z.string().max(199).optional(),
  instruction: z.string().max(5000).optional(),
}).strict();

export const medicalHistoryListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.union([z.coerce.number().int().min(1).max(100), z.literal('all')]).default(10),
  patientId: z.coerce.number().int().optional(),
  encounterId: z.coerce.number().int().optional(),
  type: z.string().optional(),
  search: z.string().optional(),  // matches title
});
export const medicalHistoryCreateSchema = z.object({
  encounterId: z.coerce.number().int(),
  patientId: z.coerce.number().int(),
  type: z.string().min(1).max(191).default('general'),
  title: z.string().min(1).max(5000),
});
export const medicalHistoryUpdateSchema = z.object({
  type: z.string().min(1).max(191).optional(),
  title: z.string().min(1).max(5000).optional(),
}).strict();

export const medReportListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.union([z.coerce.number().int().min(1).max(100), z.literal('all')]).default(10),
  patientId: z.coerce.number().int().optional(),
  search: z.string().optional(),  // matches name
});
export const medReportCreateSchema = z.object({
  patientId: z.coerce.number().int(),
  name: z.string().min(1).max(2000),
  uploadReport: z.string().min(1).max(20),   // existing WP media id
  date: z.string().optional(),               // ISO / YYYY-MM-DD; default now
});

export const receptionistListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.union([z.coerce.number().int().min(1).max(100), z.literal('all')]).default(10),
  clinicId: z.coerce.number().int().optional(),
  search: z.string().optional(),   // matches display_name / user_email
});
export const receptionistCreateSchema = z.object({
  name: z.string().min(1).max(250),
  email: z.string().email().max(100),
  clinicId: z.coerce.number().int().optional(),  // SUPER_ADMIN sets; else derived from actor
});
export const receptionistUpdateSchema = z.object({
  name: z.string().min(1).max(250).optional(),
}).strict();   // email changes disallowed (WP-synced); clinic reassignment is a separate concern

export const DAY_ENUM = ['mon','tue','wed','thu','fri','sat','sun'] as const;
export const doctorSessionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.union([z.coerce.number().int().min(1).max(100), z.literal('all')]).default(10),
  clinicId: z.coerce.number().int().optional(),
  doctorId: z.coerce.number().int().optional(),
  day: z.enum(DAY_ENUM).optional(),
});
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;   // HH:mm or HH:mm:ss
export const doctorSessionCreateSchema = z.object({
  clinicId: z.coerce.number().int().optional(),   // derived from actor for non-super
  doctorId: z.coerce.number().int(),
  day: z.enum(DAY_ENUM),
  startTime: z.string().regex(TIME_RE),
  endTime: z.string().regex(TIME_RE),
  timeSlot: z.coerce.number().int().min(1).max(240).default(30),
});
export const doctorSessionUpdateSchema = z.object({
  day: z.enum(DAY_ENUM).optional(),
  startTime: z.string().regex(TIME_RE).optional(),
  endTime: z.string().regex(TIME_RE).optional(),
  timeSlot: z.coerce.number().int().min(1).max(240).optional(),
}).strict();

export const SCHEDULE_MODULE = ['clinic', 'doctor'] as const;
export const SCHEDULE_SELECTION = ['single', 'range', 'multiple'] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE2 = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export const scheduleListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.union([z.coerce.number().int().min(1).max(100), z.literal('all')]).default(10),
  moduleType: z.enum(SCHEDULE_MODULE).optional(),
  moduleId: z.coerce.number().int().optional(),
});
export const scheduleCreateSchema = z.object({
  moduleType: z.enum(SCHEDULE_MODULE),
  moduleId: z.coerce.number().int(),
  selectionMode: z.enum(SCHEDULE_SELECTION),
  startDate: z.string().regex(DATE_RE).optional(),
  endDate: z.string().regex(DATE_RE).optional(),
  selectedDates: z.string().max(5000).optional(),  // CSV/JSON of dates for 'multiple'
  timeSpecific: z.coerce.boolean().default(false),
  startTime: z.string().regex(TIME_RE2).optional(),
  endTime: z.string().regex(TIME_RE2).optional(),
  timezone: z.string().max(64).optional(),
  description: z.string().max(5000).optional(),
  status: z.coerce.number().int().min(0).max(1).default(1),
});
export const scheduleUpdateSchema = scheduleCreateSchema.partial().omit({ moduleType: true, moduleId: true }).strict();
export const unavailableScheduleSchema = z.object({
  moduleType: z.enum(SCHEDULE_MODULE),
  moduleId: z.coerce.number().int(),
  startDate: z.string().regex(DATE_RE).optional(),
  endDate: z.string().regex(DATE_RE).optional(),
});
export const ratingListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.union([z.coerce.number().int().min(1).max(100), z.literal('all')]).default(10),
  doctorId: z.coerce.number().int().optional(),
  patientId: z.coerce.number().int().optional(),
});
export const ratingCreateSchema = z.object({
  doctorId: z.coerce.number().int(),
  patientId: z.coerce.number().int().optional(),   // forced to actor for CLIENT
  review: z.coerce.number().int().min(1).max(5),
  reviewDescription: z.string().max(5000).optional(),
});

export const dashboardQuerySchema = z.object({
  dateFrom: z.string().regex(DATE_RE).optional(),
  dateTo: z.string().regex(DATE_RE).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  period: z.enum(['day', 'month']).default('month'),  // revenue-chart granularity
});
