// Faz 17 — Binance Credential / Permission / IP Validation
// Read-only types. No order endpoint references. Secrets never leak via these types.

export type ChecklistState = "unknown" | "confirmed" | "failed";

export interface CredentialPresence {
  apiKeyPresent: boolean;
  apiSecretPresent: boolean;
  apiKeyMasked: string | null;
  baseUrl: string;
  usingTestnet: boolean;
  credentialConfigured: boolean;
}

export interface FuturesAccessResult {
  futuresAccessOk: boolean;
  accountReadOk: boolean;
  permissionError: string | null;
  errorCode: string | null;
  errorMessageSafe: string | null;
  lastCheckedAt: string;
}

export interface BinanceSecurityChecklist {
  withdrawPermissionDisabled: ChecklistState;
  ipRestrictionConfigured: ChecklistState;
  futuresPermissionConfirmed: ChecklistState;
  extraPermissionsReviewed: ChecklistState;
  updatedAt: string | null;
}

export interface BinanceCredentialStatus {
  presence: CredentialPresence;
  futuresAccess: FuturesAccessResult;
  checklist: BinanceSecurityChecklist;
  recommendedVpsIp: string;
  liveGateOpen: boolean;
}

export const EXPECTED_VPS_IP = "72.62.146.159" as const;

export const DEFAULT_CHECKLIST: BinanceSecurityChecklist = {
  withdrawPermissionDisabled: "unknown",
  ipRestrictionConfigured: "unknown",
  futuresPermissionConfirmed: "unknown",
  extraPermissionsReviewed: "unknown",
  updatedAt: null,
};
