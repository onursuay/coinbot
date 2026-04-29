// Phase 5 — Birleşik Aday Havuz Entegrasyonu (barrel).
//
// Pure orchestration: combines GMT/MT/MİL into a unified pool. No HTTP,
// no signal-engine call, no risk-engine call, no live-trading change.

export * from "./types";
export {
  buildUnifiedCandidatePool,
  emptyUnifiedPool,
} from "./build-unified-candidates";
