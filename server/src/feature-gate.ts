// The feature-level code-review mark lives in `writes/feature-gate.ts`, its command in `cli/feature-gate-command.ts`
// (spec 059, T52); this shim keeps the old import path until T61 removes it.
export {
  FEATURE_ARG,
  FEATURE_GATE_TO,
  type FeatureGateOptions,
  type FeatureGateResult,
  type FeatureGateTarget,
  codeReviewFeature,
  featureGateEventCommand,
  featureMarkPath,
} from "./writes/index.ts";
