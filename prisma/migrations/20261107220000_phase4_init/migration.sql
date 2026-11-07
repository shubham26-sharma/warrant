-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MandateStatus" AS ENUM ('DRAFT', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "CartProposalSource" AS ENUM ('AGENT_LIVE', 'AGENT_SCRIPTED');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('APPROVE', 'REVIEW', 'BLOCK');

-- CreateTable
CREATE TABLE "Mandate" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "constraints" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "status" "MandateStatus" NOT NULL,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "Mandate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartProposal" (
    "id" TEXT NOT NULL,
    "mandateId" TEXT NOT NULL,
    "cart" JSONB NOT NULL,
    "cartHash" TEXT NOT NULL,
    "source" "CartProposalSource" NOT NULL,

    CONSTRAINT "CartProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "cartProposalId" TEXT NOT NULL,
    "mandateHash" TEXT NOT NULL,
    "cartHash" TEXT NOT NULL,
    "verdict" "Verdict" NOT NULL,
    "ruleResults" JSONB NOT NULL,
    "aiResult" JSONB,
    "reasons" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HumanApproval" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HumanApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayPalOrder" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "paypalOrderId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "captureId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayPalOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SemanticCache" (
    "id" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "mandateHash" TEXT NOT NULL,
    "cartHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SemanticCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Mandate_familyId_status_version_idx" ON "Mandate"("familyId", "status", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Mandate_familyId_version_key" ON "Mandate"("familyId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "HumanApproval_decisionId_key" ON "HumanApproval"("decisionId");

-- CreateIndex
CREATE UNIQUE INDEX "PayPalOrder_decisionId_key" ON "PayPalOrder"("decisionId");

-- CreateIndex
CREATE UNIQUE INDEX "PayPalOrder_paypalOrderId_key" ON "PayPalOrder"("paypalOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "SemanticCache_promptVersion_modelName_mandateHash_cartHash_key" ON "SemanticCache"("promptVersion", "modelName", "mandateHash", "cartHash");

-- AddForeignKey
ALTER TABLE "CartProposal" ADD CONSTRAINT "CartProposal_mandateId_fkey" FOREIGN KEY ("mandateId") REFERENCES "Mandate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_cartProposalId_fkey" FOREIGN KEY ("cartProposalId") REFERENCES "CartProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanApproval" ADD CONSTRAINT "HumanApproval_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayPalOrder" ADD CONSTRAINT "PayPalOrder_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

