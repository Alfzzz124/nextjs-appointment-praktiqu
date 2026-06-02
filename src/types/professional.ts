/**
 * TypeScript types for Professional Management (Feature 002).
 *
 * These mirror the Prisma models but add convenience types for API
 * request/response shapes that cross multiple models.
 */

import type { ProfessionalType, ProfessionalStatus } from '@prisma/client';

// ============================================
// Domain Types (mirrors Prisma)
// ============================================

export type { ProfessionalType, ProfessionalStatus };

export interface Professional {
  id: string;
  userId: string;
  practiceId: string | null;
  fullName: string;
  email: string;
  professionalType: ProfessionalType;
  registrationNumber: string;
  status: ProfessionalStatus;
  biography: string | null;
  specialties: string[] | null;
  contactInfo: ContactInfo | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContactInfo {
  phone?: string;
  address?: string;
  city?: string;
  [key: string]: unknown;
}

// ============================================
// Availability (Feature 003)
// ============================================

export interface AvailabilityWindow {
  id?: string;
  dayOfWeek: number; // 0=Sun, 6=Sat
  startMinute: number; // minutes from 00:00 in practice TZ
  endMinute: number;
}

export interface WeeklySchedule {
  [dayOfWeek: number]: AvailabilityWindow[];
}

// ============================================
// Off Days
// ============================================

export interface ProfessionalOffDay {
  id: string;
  professionalId: string;
  startDate: Date;
  endDate: Date;
  reason: string | null;
  createdAt: Date;
}

// ============================================
// Service Assignment
// ============================================

export interface ProfessionalServiceAssignment {
  id: string;
  professionalId: string;
  serviceId: string;
  createdAt: Date;
}

// Minimal service info from the Service model
export interface ServiceSummary {
  id: string;
  name: string;
  duration: number; // in minutes
  price: string; // Decimal as string
  status: number; // 1=active, 0=inactive
}

// ============================================
// Slot (Generated)
// ============================================

export interface BookableSlot {
  startUtc: Date;  // UTC datetime
  endUtc: Date;    // UTC datetime
  serviceId: string;
  professionalId: string;
}

// ============================================
// API Request / Response Shapes
// ============================================

// ---- Pagination ----
export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

// ---- List Response ----
export interface ProfessionalListResponse {
  data: ProfessionalWithPractice[];
  pagination: PaginationMeta;
}

export interface ProfessionalWithPractice extends Professional {
  practiceName: string | null;
}

// ---- Create ----
export interface CreateProfessionalInput {
  userId: string;
  practiceId?: string | null;
  fullName: string;
  email: string;
  professionalType: ProfessionalType;
  registrationNumber: string;
  biography?: string;
  specialties?: string[];
  contactInfo?: ContactInfo;
}

// ---- Update ----
export interface UpdateProfessionalInput {
  fullName?: string;
  biography?: string | null;
  specialties?: string[] | null;
  contactInfo?: ContactInfo | null;
}

// Self-edit restrictions (US2): can only update these fields
export interface SelfUpdateProfessionalInput {
  biography?: string | null;
  specialties?: string[] | null;
  contactInfo?: ContactInfo | null;
}

// ---- Status Change ----
export interface StatusChangeInput {
  status: ProfessionalStatus;
}

// ---- Availability ----
export interface SetAvailabilityInput {
  schedule: AvailabilityWindow[];
}

// ---- Off Days ----
export interface CreateOffDayInput {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  reason?: string;
}

export interface OffDayResponse {
  id: string;
  professionalId: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  createdAt: string;
}

// ---- Service Assignment ----
export interface AssignServiceInput {
  serviceId: string;
}

// ---- Slot Query ----
export interface SlotQueryParams {
  date: string; // YYYY-MM-DD
  serviceId: string;
}

// ============================================
// API Error Response
// ============================================

export interface ApiErrorResponse {
  error: string;
  code: string;
  detail?: string;
  fields?: Record<string, string[]>;
}