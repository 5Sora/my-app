export { AiFoundation, createSafetyIdentifier } from "./client.js";
export type {
  AiStructuredRequest,
  AiStructuredResult,
  ResponsesParser,
} from "./client.js";
export { loadAiConfig, getFeatureConfig } from "./config.js";
export type {
  AiConfig,
  AiFeature,
  AiFeatureLimits,
  AiFeatureRuntimeConfig,
} from "./config.js";
export { AiError, normalizeProviderError, toPublicAiError } from "./errors.js";
export type { AiErrorCode, PublicAiError } from "./errors.js";
export { MemoryAiGuards } from "./guards.js";
export { defaultAiLogger } from "./logger.js";
export type { AiLogEvent, AiLogger, AiUsage } from "./logger.js";

export {
  buildPersonalTransactionClassificationInstructions,
  classifyPersonalTransactionWithAi,
  personalTransactionClassificationSchema,
  transactionTypeToFormKind,
} from "./transaction-classification.js";
export type {
  PersonalTransactionClassification,
  PersonalTransactionClassificationResult,
} from "./transaction-classification.js";
export {
  AI_SUGGESTION_LIFETIME_MS,
  createSuggestionToken,
  resolvePersonalTransactionClassification,
  verifySuggestionToken,
} from "./suggestion-token.js";
export type { SuggestionTokenPayload } from "./suggestion-token.js";
