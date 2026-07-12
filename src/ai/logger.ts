import type { AiErrorCode } from "./errors.js";
import type { AiFeature } from "./config.js";

export type AiUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type AiLogEvent = {
  event: "ai_request";
  feature: AiFeature;
  provider: "OPENAI";
  model: string;
  success: boolean;
  fallback: boolean;
  errorCode: AiErrorCode | null;
  durationMs: number;
  attempts: number;
  anonymousUserKey: string;
  usage: AiUsage;
  occurredAt: string;
};

export type AiLogger = (event: AiLogEvent) => void;

export const defaultAiLogger: AiLogger = (event) => {
  console.info(JSON.stringify(event));
};
