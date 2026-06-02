-- Migration: add_client_management
-- Feature 004: Client Management
-- Adds the Client model and the Gender / ClientStatus enums.

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "uniqueClientId" TEXT NOT NULL,
    "fullName" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "mobileNumber" VARCHAR(20) NOT NULL,
    "dateOfBirth" TIMESTAMP(3) NOT NULL,
    "gender" "Gender" NOT NULL,
    "address" TEXT,
    "emergencyContact" VARCHAR(100),
    "notes" TEXT,
    "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clients_userId_key" ON "clients"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "clients_practiceId_uniqueClientId_key" ON "clients"("practiceId", "uniqueClientId");

-- CreateIndex
CREATE UNIQUE INDEX "clients_practiceId_email_key" ON "clients"("practiceId", "email");

-- CreateIndex
CREATE INDEX "clients_practiceId_status_idx" ON "clients"("practiceId", "status");

-- CreateIndex
CREATE INDEX "clients_fullName_idx" ON "clients"("fullName");

-- CreateIndex
CREATE INDEX "clients_mobileNumber_idx" ON "clients"("mobileNumber");
