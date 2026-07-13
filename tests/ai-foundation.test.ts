import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  AiError,
  AiFoundation,
  MemoryAiGuards,
  createSafetyIdentifier,
  loadAiConfig,
  type AiConfig,
  type AiLogEvent,
  type ResponsesParser,
} from "../src/ai/index.js";

const resultSchema = z.object({
  value: z.string(),
});

function makeConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  const base = loadAiConfig({
    OPENAI_API_KEY: "test-key",
    AI_SAFETY_SALT: "test-salt-with-sufficient-entropy",
    AI_FEATURE_ENABLED: "true",
    AI_CLASSIFICATION_ENABLED: "true",
    AI_ANALYSIS_ENABLED: "true",
  });
  return {
    ...base,
    ...overrides,
    classification: {
      ...base.classification,
      ...(overrides.classification || {}),
      limits: {
        ...base.classification.limits,
        ...(overrides.classification?.limits || {}),
      },
    },
    analysis: {
      ...base.analysis,
      ...(overrides.analysis || {}),
      limits: {
        ...base.analysis.limits,
        ...(overrides.analysis?.limits || {}),
      },
    },
  };
}

function request() {
  return {
    feature: "classification" as const,
    userId: 123,
    schema: resultSchema,
    schemaName: "test_result",
    instructions: "Return the requested structured value.",
    input: "private natural language input",
  };
}

test("loadAiConfig reads feature flags and approved default limits", () => {
  const config = loadAiConfig({
    AI_FEATURE_ENABLED: "false",
    AI_CLASSIFICATION_ENABLED: "true",
    AI_ANALYSIS_ENABLED: "false",
  });
  assert.equal(config.enabled, false);
  assert.equal(config.classification.enabled, true);
  assert.equal(config.analysis.enabled, false);
  assert.equal(config.classification.limits.globalMinute, 20);
  assert.equal(config.analysis.limits.globalMinute, 5);
  assert.equal(config.classification.maxOutputTokens, 500);
  assert.equal(config.analysis.maxOutputTokens, 1_200);
});

test("createSafetyIdentifier is stable and does not expose the user id", () => {
  const first = createSafetyIdentifier(123, "stable-secret-salt");
  const second = createSafetyIdentifier(123, "stable-secret-salt");
  const other = createSafetyIdentifier(124, "stable-secret-salt");
  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.match(first, /^ai_[a-f0-9]{61}$/);
  assert.equal(first.length, 64);
  assert.equal(first.includes("123"), false);
});

test("MemoryAiGuards enforces user and global limits", () => {
  let now = Date.parse("2026-07-12T03:00:00.000Z");
  const guards = new MemoryAiGuards(() => now);
  const limits = {
    userMinute: 1,
    userDaily: 10,
    globalMinute: 2,
    globalDaily: 100,
  };

  guards.consume("classification", "user-a", limits);
  assert.throws(
    () => guards.consume("classification", "user-a", limits),
    (error: unknown) => error instanceof AiError && error.code === "RATE_LIMITED",
  );
  guards.consume("classification", "user-b", limits);
  assert.throws(
    () => guards.consume("classification", "user-c", limits),
    (error: unknown) => error instanceof AiError && error.code === "RATE_LIMITED",
  );

  now += 60_000;
  guards.consume("classification", "user-a", limits);
});



test("daily limits reset at the Asia/Tokyo date boundary", () => {
  let now = Date.parse("2026-07-12T14:59:59.000Z");
  const guards = new MemoryAiGuards(() => now);
  const limits = {
    userMinute: 10,
    userDaily: 1,
    globalMinute: 10,
    globalDaily: 10,
  };

  guards.consume("classification", "user-a", limits);
  assert.throws(
    () => guards.consume("classification", "user-a", limits),
    (error: unknown) => error instanceof AiError && error.code === "RATE_LIMITED",
  );

  now = Date.parse("2026-07-12T15:00:00.000Z");
  guards.consume("classification", "user-a", limits);
});

test("MemoryAiGuards rejects the same user and feature while locked", () => {
  const guards = new MemoryAiGuards();
  const release = guards.acquireLock("analysis", "anonymous-user");
  assert.throws(
    () => guards.acquireLock("analysis", "anonymous-user"),
    (error: unknown) =>
      error instanceof AiError && error.code === "CONCURRENT_REQUEST",
  );
  const otherFeatureRelease = guards.acquireLock(
    "classification",
    "anonymous-user",
  );
  otherFeatureRelease();
  release();
  const releaseAgain = guards.acquireLock("analysis", "anonymous-user");
  releaseAgain();
});

test("executeStructured sends store:false, a strict schema, model and safety identifier", async () => {
  const calls: Array<{ body: Record<string, unknown>; options?: { signal?: AbortSignal } }> = [];
  const logs: AiLogEvent[] = [];
  const parser: ResponsesParser = {
    async parse(body, options) {
      calls.push({ body, options });
      return {
        output_parsed: { value: "ok" },
        usage: { input_tokens: 11, output_tokens: 4, total_tokens: 15 },
      };
    },
  };
  const foundation = new AiFoundation(makeConfig(), {
    parser,
    logger: (event) => logs.push(event),
  });

  const result = await foundation.executeStructured(request());

  assert.deepEqual(result.data, { value: "ok" });
  assert.equal(result.attempts, 1);
  assert.deepEqual(result.usage, {
    inputTokens: 11,
    outputTokens: 4,
    totalTokens: 15,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.store, false);
  assert.equal(calls[0].body.model, "gpt-5.4-nano");
  assert.equal(calls[0].body.max_output_tokens, 500);
  assert.match(String(calls[0].body.safety_identifier), /^ai_[a-f0-9]{61}$/);
  assert.equal(String(calls[0].body.safety_identifier).length, 64);
  const text = calls[0].body.text as {
    format?: { type?: string; strict?: boolean; name?: string };
  };
  assert.equal(text.format?.type, "json_schema");
  assert.equal(text.format?.strict, true);
  assert.equal(text.format?.name, "test_result");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].success, true);
  assert.equal(logs[0].attempts, 1);

  const serializedLog = JSON.stringify(logs[0]);
  assert.equal(serializedLog.includes("private natural language input"), false);
  assert.equal(serializedLog.includes("test-key"), false);
});

test("429 is retried once and one request consumes one usage allowance", async () => {
  let calls = 0;
  const parser: ResponsesParser = {
    async parse() {
      calls += 1;
      if (calls === 1) throw { status: 429 };
      return { output_parsed: { value: "retried" } };
    },
  };
  const config = makeConfig({
    retryBaseDelayMs: 1,
    retryJitterMs: 0,
    classification: {
      ...makeConfig().classification,
      limits: {
        userMinute: 1,
        userDaily: 1,
        globalMinute: 10,
        globalDaily: 10,
      },
    },
  });
  const foundation = new AiFoundation(config, {
    parser,
    sleep: async () => undefined,
    random: () => 0,
    logger: () => undefined,
  });

  const result = await foundation.executeStructured(request());
  assert.equal(result.attempts, 2);
  assert.equal(calls, 2);

  await assert.rejects(
    foundation.executeStructured(request()),
    (error: unknown) => error instanceof AiError && error.code === "RATE_LIMITED",
  );
  assert.equal(calls, 2);
});



test("temporary 5xx is retried once", async () => {
  let calls = 0;
  const parser: ResponsesParser = {
    async parse() {
      calls += 1;
      if (calls === 1) throw { status: 503 };
      return { output_parsed: { value: "recovered" } };
    },
  };
  const foundation = new AiFoundation(
    makeConfig({ retryBaseDelayMs: 1, retryJitterMs: 0 }),
    {
      parser,
      logger: () => undefined,
      sleep: async () => undefined,
      random: () => 0,
    },
  );

  const result = await foundation.executeStructured(request());
  assert.equal(result.data.value, "recovered");
  assert.equal(result.attempts, 2);
  assert.equal(calls, 2);
});

test("400 is not retried", async () => {
  let calls = 0;
  const parser: ResponsesParser = {
    async parse() {
      calls += 1;
      throw { status: 400 };
    },
  };
  const foundation = new AiFoundation(makeConfig(), {
    parser,
    logger: () => undefined,
  });

  await assert.rejects(
    foundation.executeStructured(request()),
    (error: unknown) =>
      error instanceof AiError && error.code === "PROVIDER_REQUEST_ERROR",
  );
  assert.equal(calls, 1);
});

test("schema mismatch is rejected without retry", async () => {
  let calls = 0;
  const parser: ResponsesParser = {
    async parse() {
      calls += 1;
      return { output_parsed: { value: 123 } };
    },
  };
  const foundation = new AiFoundation(makeConfig(), {
    parser,
    logger: () => undefined,
  });

  await assert.rejects(
    foundation.executeStructured(request()),
    (error: unknown) => error instanceof AiError && error.code === "SCHEMA_ERROR",
  );
  assert.equal(calls, 1);
});

test("feature flag and missing settings are distinguished", async () => {
  const parser: ResponsesParser = {
    async parse() {
      return { output_parsed: { value: "unused" } };
    },
  };
  const disabled = new AiFoundation(makeConfig({ enabled: false }), {
    parser,
    logger: () => undefined,
  });
  await assert.rejects(
    disabled.executeStructured(request()),
    (error: unknown) =>
      error instanceof AiError && error.code === "FEATURE_DISABLED",
  );

  const missingKey = new AiFoundation(makeConfig({ apiKey: "" }), {
    parser,
    logger: () => undefined,
  });
  await assert.rejects(
    missingKey.executeStructured(request()),
    (error: unknown) =>
      error instanceof AiError && error.code === "CONFIGURATION_ERROR",
  );
});

test("attempt timeout is normalized and limited to two attempts", async () => {
  let calls = 0;
  const parser: ResponsesParser = {
    async parse(_body, options) {
      calls += 1;
      return await new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(new Error("aborted provider request")),
          { once: true },
        );
      });
    },
  };
  const base = makeConfig();
  const foundation = new AiFoundation(
    makeConfig({
      retryBaseDelayMs: 1,
      retryJitterMs: 0,
      classification: {
        ...base.classification,
        totalTimeoutMs: 300,
        firstAttemptTimeoutMs: 60,
      },
    }),
    {
      parser,
      logger: () => undefined,
      sleep: async () => undefined,
      random: () => 0,
    },
  );

  await assert.rejects(
    foundation.executeStructured(request()),
    (error: unknown) => error instanceof AiError && error.code === "TIMEOUT",
  );
  assert.equal(calls, 2);
});

test("concurrent execution for the same user and feature returns 409-class error", async () => {
  let resolveFirst: ((value: ParsedResponseForTest) => void) | undefined;
  type ParsedResponseForTest = { output_parsed: unknown };
  const parser: ResponsesParser = {
    async parse() {
      return await new Promise<ParsedResponseForTest>((resolve) => {
        resolveFirst = resolve;
      });
    },
  };
  const foundation = new AiFoundation(makeConfig(), {
    parser,
    logger: () => undefined,
  });

  const first = foundation.executeStructured(request());
  await Promise.resolve();
  await assert.rejects(
    foundation.executeStructured(request()),
    (error: unknown) =>
      error instanceof AiError &&
      error.code === "CONCURRENT_REQUEST" &&
      error.httpStatus === 409,
  );
  resolveFirst?.({ output_parsed: { value: "done" } });
  await first;
});
