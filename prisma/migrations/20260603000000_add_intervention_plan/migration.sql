-- Migration: add_intervention_plan
-- Feature 009: Intervention Plan
-- Adds the InterventionPlan and RecommendationItem models plus their
-- PlanStatus / ItemStatus enums.

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('ACTIVE', 'COMPLETED');

-- CreateTable
CREATE TABLE "intervention_plans" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intervention_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation_items" (
    "id" TEXT NOT NULL,
    "interventionPlanId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "frequency" TEXT,
    "durationDays" INTEGER,
    "instructions" TEXT,
    "status" "ItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recommendation_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "intervention_plans_sessionId_key" ON "intervention_plans"("sessionId");

-- CreateIndex
CREATE INDEX "intervention_plans_professionalId_idx" ON "intervention_plans"("professionalId");

-- CreateIndex
CREATE INDEX "intervention_plans_clientId_idx" ON "intervention_plans"("clientId");

-- CreateIndex
CREATE INDEX "intervention_plans_status_idx" ON "intervention_plans"("status");

-- CreateIndex
CREATE INDEX "recommendation_items_interventionPlanId_idx" ON "recommendation_items"("interventionPlanId");

-- CreateIndex
CREATE INDEX "recommendation_items_status_idx" ON "recommendation_items"("status");

-- AddForeignKey
ALTER TABLE "recommendation_items" ADD CONSTRAINT "recommendation_items_interventionPlanId_fkey" FOREIGN KEY ("interventionPlanId") REFERENCES "intervention_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
