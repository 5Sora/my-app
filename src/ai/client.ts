import { createHmac } from "node:crypto";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ZodType } from "zod";
import type { AiConfig, AiFeature } from "./config.js";
import { getFeatureConfig } from "./config.js";
import { AiError, normalizeProviderError } from "./errors.js";
import { MemoryAiGuards } from "./guards.js";
import {
  defaultAiLogger,
  type AiLogger,
  type AiUsage,
} from "./logger.js";

type ResponseUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
};

type ParsedResponse = {
  output_parsed: unknown;
  usage?: ResponseUsage | null;
};

export type ResponsesParser = {
  parse(body: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<ParsedResponse>;
};

export type AiStructuredRequest<T> = {
  feature: AiFeature;
  userId: number | string;
  schema: ZodType<T>;
  schemaName: string;
  instructions: string;
  input: string | Array<Record<string, unknown>>;
};

export type AiStructuredResult<T> = {
  data: T;
  model: string;
  attempts: number;
  durationMs: number;
  usage: AiUsage;
};

type AiFoundationDependencies = {
  parser?: ResponsesParser;
  guards?: MemoryAiGuards;
  logger?: AiLogger;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
};

export class AiFoundation {
  private readonly parser: ResponsesParser;
  private readonly guards: MemoryAiGuards;
  private readonly logger: AiLogger;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;

  constructor(
    private readonly config: AiConfig,
    dependencies: AiFoundationDependencies = {},
  ) {
    this.parser = dependencies.parser || createOpenAiParser(config.apiKey);
    this.guards = dependencies.guards || new MemoryAiGuards(dependencies.now);
    this.logger = dependencies.logger || defaultAiLogger;
    this.now = dependencies.now || Date.now;
    this.sleep = dependencies.sleep || delay;
    this.random = dependencies.random || Math.random;
  }

  async executeStructured<T>(
    request: AiStructuredRequest<T>,
  ): Promise<AiStructuredResult<T>> {
    const featureConfig = getFeatureConfig(this.config, request.feature);
    const startedAt = this.now();
    let attempts = 0;
    let usage = emptyUsage();
    let anonymousUserKey = "ai_unavailable";
    let releaseLock = () => undefined;

    try {
      this.assertAvailable(request.feature);
      anonymousUserKey = createSafetyIdentifier(
        request.userId,
        this.config.safetySalt,
      );
      releaseLock = this.guards.acquireLock(
        request.feature,
        anonymousUserKey,
      );
      this.guards.consume(
        request.feature,
        anonymousUserKey,
        featureConfig.limits,
      );

      const deadline = startedAt + featureConfig.totalTimeoutMs;
      let lastError: AiError | null = null;

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        attempts = attempt;
        const remainingMs = deadline - this.now();
        if (remainingMs <= 0) {
          lastError = new AiError("TIMEOUT", { retryable: false });
          break;
        }

        const attemptTimeoutMs =
          attempt === 1
            ? Math.min(featureConfig.firstAttemptTimeoutMs, remainingMs)
            : remainingMs;

        try {
          const response = await this.parseWithTimeout(
            {
              model: featureConfig.model,
              instructions: request.instructions,
              input: request.input,
              text: {
                format: zodTextFormat(request.schema, request.schemaName),
              },
              max_output_tokens: featureConfig.maxOutputTokens,
              store: false,
              safety_identifier: anonymousUserKey,
            },
            attemptTimeoutMs,
          );

          usage = normalizeUsage(response.usage);
          const parsed = request.schema.safeParse(response.output_parsed);
          if (!parsed.success) {
            throw new AiError("SCHEMA_ERROR", { cause: parsed.error });
          }

          const durationMs = Math.max(0, this.now() - startedAt);
          this.logger({
            event: "ai_request",
            feature: request.feature,
            provider: "OPENAI",
            model: featureConfig.model,
            success: true,
            fallback: false,
            errorCode: null,
            durationMs,
            attempts,
            anonymousUserKey,
            usage,
            occurredAt: new Date(this.now()).toISOString(),
          });

          return {
            data: parsed.data,
            model: featureConfig.model,
            attempts,
            durationMs,
            usage,
          };
        } catch (error) {
          const normalized =
            error instanceof AiError ? error : normalizeProviderError(error);
          lastError = normalized;

          if (attempt >= 2 || !normalized.retryable) break;

          const backoffMs =
            this.config.retryBaseDelayMs +
            Math.floor(this.random() * (this.config.retryJitterMs + 1));
          if (this.now() + backoffMs >= deadline) {
            lastError = new AiError("TIMEOUT", { retryable: false });
            break;
          }
          await this.sleep(backoffMs);
        }
      }

      throw lastError || new AiError("PROVIDER_ERROR");
    } catch (error) {
      const normalized =
        error instanceof AiError ? error : normalizeProviderError(error);
      const durationMs = Math.max(0, this.now() - startedAt);
      this.logger({
        event: "ai_request",
        feature: request.feature,
        provider: "OPENAI",
        model: featureConfig.model,
        success: false,
        fallback: false,
        errorCode: normalized.code,
        durationMs,
        attempts,
        anonymousUserKey,
        usage,
        occurredAt: new Date(this.now()).toISOString(),
      });
      throw normalized;
    } finally {
      releaseLock();
    }
  }

  private assertAvailable(feature: AiFeature): void {
    const featureConfig = getFeatureConfig(this.config, feature);
    if (!this.config.enabled || !featureConfig.enabled) {
      throw new AiError("FEATURE_DISABLED");
    }
    if (!this.config.apiKey || !this.config.safetySalt || !featureConfig.model) {
      throw new AiError("CONFIGURATION_ERROR");
    }
  }

  private async parseWithTimeout(
    body: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<ParsedResponse> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      return await this.parser.parse(body, { signal: controller.signal });
    } catch (error) {
      throw normalizeProviderError(error, timedOut);
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createSafetyIdentifier(
  userId: number | string,
  safetySalt: string,
): string {
  if (!safetySalt.trim()) {
    throw new AiError("CONFIGURATION_ERROR");
  }
  const digest = createHmac("sha256", safetySalt)
    .update(String(userId))
    .digest("hex");
  return `ai_${digest}`;
}

function createOpenAiParser(apiKey: string): ResponsesParser {
  const client = new OpenAI({ apiKey: apiKey || "missing", maxRetries: 0 });
  return client.responses as unknown as ResponsesParser;
}

function normalizeUsage(usage?: ResponseUsage | null): AiUsage {
  return {
    inputTokens: toNullableNumber(usage?.input_tokens),
    outputTokens: toNullableNumber(usage?.output_tokens),
    totalTokens: toNullableNumber(usage?.total_tokens),
  };
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function emptyUsage(): AiUsage {
  return { inputTokens: null, outputTokens: null, totalTokens: null };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
