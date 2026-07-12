export type AiFeature = "classification" | "analysis";

export type AiFeatureLimits = {
  userMinute: number;
  userDaily: number;
  globalMinute: number;
  globalDaily: number;
};

export type AiFeatureRuntimeConfig = {
  enabled: boolean;
  model: string;
  totalTimeoutMs: number;
  firstAttemptTimeoutMs: number;
  maxOutputTokens: number;
  limits: AiFeatureLimits;
};

export type AiConfig = {
  provider: "OPENAI";
  enabled: boolean;
  apiKey: string;
  safetySalt: string;
  retryBaseDelayMs: number;
  retryJitterMs: number;
  classification: AiFeatureRuntimeConfig;
  analysis: AiFeatureRuntimeConfig;
};

function readBoolean(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: boolean,
): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return defaultValue;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

function readPositiveInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: number,
): number {
  const raw = env[name]?.trim();
  if (!raw) return defaultValue;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function readNonNegativeInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: number,
): number {
  const raw = env[name]?.trim();
  if (!raw) return defaultValue;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return value;
}

function readModel(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: string,
): string {
  return env[name]?.trim() || defaultValue;
}

export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  return {
    provider: "OPENAI",
    enabled: readBoolean(env, "AI_FEATURE_ENABLED", true),
    apiKey: env.OPENAI_API_KEY?.trim() || "",
    safetySalt: env.AI_SAFETY_SALT?.trim() || "",
    retryBaseDelayMs: readPositiveInteger(env, "AI_RETRY_BASE_DELAY_MS", 250),
    retryJitterMs: readNonNegativeInteger(env, "AI_RETRY_JITTER_MS", 150),
    classification: {
      enabled: readBoolean(env, "AI_CLASSIFICATION_ENABLED", true),
      model: readModel(env, "OPENAI_CLASSIFICATION_MODEL", "gpt-5.4-nano"),
      totalTimeoutMs: readPositiveInteger(
        env,
        "AI_CLASSIFICATION_TIMEOUT_MS",
        10_000,
      ),
      firstAttemptTimeoutMs: readPositiveInteger(
        env,
        "AI_CLASSIFICATION_FIRST_ATTEMPT_TIMEOUT_MS",
        6_000,
      ),
      maxOutputTokens: readPositiveInteger(
        env,
        "AI_CLASSIFICATION_MAX_OUTPUT_TOKENS",
        500,
      ),
      limits: {
        userMinute: readPositiveInteger(
          env,
          "AI_CLASSIFICATION_USER_MINUTE_LIMIT",
          5,
        ),
        userDaily: readPositiveInteger(
          env,
          "AI_CLASSIFICATION_USER_DAILY_LIMIT",
          10,
        ),
        globalMinute: readPositiveInteger(
          env,
          "AI_CLASSIFICATION_GLOBAL_MINUTE_LIMIT",
          20,
        ),
        globalDaily: readPositiveInteger(
          env,
          "AI_CLASSIFICATION_GLOBAL_DAILY_LIMIT",
          100,
        ),
      },
    },
    analysis: {
      enabled: readBoolean(env, "AI_ANALYSIS_ENABLED", true),
      model: readModel(env, "OPENAI_ANALYSIS_MODEL", "gpt-5.4-mini"),
      totalTimeoutMs: readPositiveInteger(env, "AI_ANALYSIS_TIMEOUT_MS", 20_000),
      firstAttemptTimeoutMs: readPositiveInteger(
        env,
        "AI_ANALYSIS_FIRST_ATTEMPT_TIMEOUT_MS",
        12_000,
      ),
      maxOutputTokens: readPositiveInteger(
        env,
        "AI_ANALYSIS_MAX_OUTPUT_TOKENS",
        1_200,
      ),
      limits: {
        userMinute: readPositiveInteger(env, "AI_ANALYSIS_USER_MINUTE_LIMIT", 1),
        userDaily: readPositiveInteger(env, "AI_ANALYSIS_USER_DAILY_LIMIT", 3),
        globalMinute: readPositiveInteger(
          env,
          "AI_ANALYSIS_GLOBAL_MINUTE_LIMIT",
          5,
        ),
        globalDaily: readPositiveInteger(env, "AI_ANALYSIS_GLOBAL_DAILY_LIMIT", 30),
      },
    },
  };
}

export function getFeatureConfig(config: AiConfig, feature: AiFeature) {
  return config[feature];
}
