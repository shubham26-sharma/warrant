import { randomUUID } from "node:crypto";
import { canonicalJson, sha256Hex } from "../hash";
import { MandateSchema, type Mandate } from "../schemas/mandate";
import type { MandateRecord } from "../store/types";

export class MandateConfirmationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MandateConfirmationError";
  }
}

export type HumanMandateEdits = Partial<Pick<
  Mandate,
  "originalText" | "currency" | "hardConstraints" | "softConstraints" | "ambiguity"
>>;

export function confirmMandate(draft: Mandate | MandateRecord, humanEdits: HumanMandateEdits): MandateRecord {
  const prior = MandateSchema.parse(draft);
  const familyId = "familyId" in draft ? draft.familyId : draft.mandateId;
  const nextVersion = prior.status === "CONFIRMED" ? prior.version + 1 : prior.version;
  const edited = MandateSchema.parse({ ...prior, ...humanEdits, status: "DRAFT", confirmedAt: null });
  if (edited.ambiguity.hasAmbiguity || edited.ambiguity.unresolvedClauses.length > 0) {
    throw new MandateConfirmationError("Resolve every ambiguity before confirming the mandate");
  }
  const confirmed = MandateSchema.parse({
    ...edited,
    mandateId: randomUUID(),
    version: nextVersion,
    status: "CONFIRMED",
    confirmedAt: new Date().toISOString(),
  });

  const hash = sha256Hex(canonicalJson({ ...confirmed, familyId }));
  return { ...confirmed, familyId, hash };
}
