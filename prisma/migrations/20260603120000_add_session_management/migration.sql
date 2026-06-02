-- Migration: add_session_management
-- Feature 005: Session Management
-- Adds the Session model and the SessionStatus enum.

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM (
  'PENDING',
  'BOOKED',
  'CHECK_IN',
  'CHECK_OUT',
  'COMPLETED',
  'REJECTED',
  'CANCELLED'
);

-- CreateTable
CREATE TABLE "sessions_booking" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "slotDate" DATE NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "cancellationReason" TEXT,
    "checkedInAt" TIMESTAMP(3),
    "checkedOutAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_booking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sessions_booking_professionalId_slotDate_status_idx" ON "sessions_booking"("professionalId", "slotDate", "status");

-- CreateIndex
CREATE INDEX "sessions_booking_clientId_slotDate_idx" ON "sessions_booking"("clientId", "slotDate");

-- CreateIndex
CREATE INDEX "sessions_booking_practiceId_slotDate_idx" ON "sessions_booking"("practiceId", "slotDate");

-- CreateIndex
CREATE INDEX "sessions_booking_status_idx" ON "sessions_booking"("status");

-- CreateIndex
CREATE INDEX "sessions_booking_slotDate_status_idx" ON "sessions_booking"("slotDate", "status");

-- CreateIndex
CREATE INDEX "sessions_booking_status_checkedOutAt_idx" ON "sessions_booking"("status", "checkedOutAt");

-- AddForeignKey
ALTER TABLE "sessions_booking" ADD CONSTRAINT "sessions_booking_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions_booking" ADD CONSTRAINT "sessions_booking_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions_booking" ADD CONSTRAINT "sessions_booking_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
