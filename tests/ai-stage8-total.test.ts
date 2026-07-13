import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { APIConnectionError } from "openai";
import { z } from "zod";
import {
  AiError,
  AiFoundation,
  MemoryAiGuards,
  loadAiConfig,
  normalizeProviderError,
  toPublicAiError,
  type AiConfig,
  type AiLogEvent,
  type ResponsesParser,
} from "../src/ai/index.js";

const execFileAsync = promisify(execFile);

const resultSchema = z.object({ value: z.string() });

function makeConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  const base = loadAiConfig({
    OPENAI_API_KEY: "test-key",
    AI_SAFETY_SALT: "stage8-total-test-salt-with-enough-entropy",
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

function request(feature: "classification" | "analysis" = "classification") {
  return {
    feature,
    userId: 123,
    fallbackOnError: true,
    schema: resultSchema,
    schemaName: "stage8_total_result",
    instructions: "Return the requested structured value.",
    input: "private input that must not be logged",
  };
}

test("401 and 403 provider responses are normalized as non-retryable authentication errors", async () => {
  for (const status of [401, 403]) {
    let calls = 0;
    const parser: ResponsesParser = {
      async parse() {
        calls += 1;
        throw { status };
      },
    };
    const foundation = new AiFoundation(makeConfig(), {
      parser,
      logger: () => undefined,
      sleep: async () => undefined,
    });

    await assert.rejects(
      foundation.executeStructured(request()),
      (error: unknown) =>
        error instanceof AiError &&
        error.code === "PROVIDER_AUTH_ERROR" &&
        error.retryable === false,
    );
    assert.equal(calls, 1);
  }
});

test("network failure is retried once and then succeeds", async () => {
  let calls = 0;
  const parser: ResponsesParser = {
    async parse() {
      calls += 1;
      if (calls === 1) {
        throw new APIConnectionError({ cause: new Error("temporary network failure") });
      }
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

test("public AI errors expose safe messages and not provider details", () => {
  const error = normalizeProviderError({ status: 500, body: "secret provider body" });
  const publicError = toPublicAiError(error);
  assert.equal(publicError.code, "PROVIDER_SERVER_ERROR");
  assert.equal(publicError.status, 502);
  assert.equal(publicError.message, "AI機能を現在利用できません。");
  assert.equal(JSON.stringify(publicError).includes("secret provider body"), false);
});

test("failure logs accurately record fallback usage and token-safe fields", async () => {
  const logs: AiLogEvent[] = [];
  const parser: ResponsesParser = {
    async parse() {
      throw { status: 400, providerBody: "must not be logged" };
    },
  };
  const foundation = new AiFoundation(makeConfig(), {
    parser,
    logger: (event) => logs.push(event),
  });

  await assert.rejects(foundation.executeStructured(request()));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].success, false);
  assert.equal(logs[0].fallback, true);
  assert.equal(logs[0].errorCode, "PROVIDER_REQUEST_ERROR");
  assert.equal(logs[0].attempts, 1);
  assert.deepEqual(logs[0].usage, {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
  });

  const serialized = JSON.stringify(logs[0]);
  for (const forbidden of [
    "private input that must not be logged",
    "test-key",
    "providerBody",
    "must not be logged",
    "stage8-total-test-salt",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("success logs record provider token usage and fallback false", async () => {
  const logs: AiLogEvent[] = [];
  const foundation = new AiFoundation(makeConfig(), {
    parser: {
      async parse() {
        return {
          output_parsed: { value: "ok" },
          usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150 },
        };
      },
    },
    logger: (event) => logs.push(event),
  });

  await foundation.executeStructured(request("analysis"));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].success, true);
  assert.equal(logs[0].fallback, false);
  assert.deepEqual(logs[0].usage, {
    inputTokens: 120,
    outputTokens: 30,
    totalTokens: 150,
  });
});

test("locks are released after success and provider failure", async () => {
  let shouldFail = true;
  const parser: ResponsesParser = {
    async parse() {
      if (shouldFail) throw { status: 400 };
      return { output_parsed: { value: "ok" } };
    },
  };
  const base = makeConfig();
  const foundation = new AiFoundation(
    makeConfig({
      classification: {
        ...base.classification,
        limits: {
          userMinute: 10,
          userDaily: 10,
          globalMinute: 10,
          globalDaily: 10,
        },
      },
    }),
    { parser, logger: () => undefined },
  );

  await assert.rejects(foundation.executeStructured(request()));
  shouldFail = false;
  const result = await foundation.executeStructured(request());
  assert.equal(result.data.value, "ok");
  const again = await foundation.executeStructured(request());
  assert.equal(again.data.value, "ok");
});

test("classification and analysis counters and locks are independent", () => {
  const guards = new MemoryAiGuards();
  const limits = { userMinute: 1, userDaily: 1, globalMinute: 10, globalDaily: 10 };
  guards.consume("classification", "user-a", limits);
  guards.consume("analysis", "user-a", limits);

  assert.throws(
    () => guards.consume("classification", "user-a", limits),
    (error: unknown) => error instanceof AiError && error.code === "RATE_LIMITED",
  );
  assert.throws(
    () => guards.consume("analysis", "user-a", limits),
    (error: unknown) => error instanceof AiError && error.code === "RATE_LIMITED",
  );

  const releaseClassification = guards.acquireLock("classification", "user-b");
  const releaseAnalysis = guards.acquireLock("analysis", "user-b");
  releaseAnalysis();
  releaseClassification();
});

test("global daily limits apply across users without partially consuming a rejected request", () => {
  const guards = new MemoryAiGuards();
  const limits = { userMinute: 10, userDaily: 10, globalMinute: 10, globalDaily: 2 };
  guards.consume("analysis", "user-a", limits);
  guards.consume("analysis", "user-b", limits);
  assert.throws(
    () => guards.consume("analysis", "user-c", limits),
    (error: unknown) => error instanceof AiError && error.code === "RATE_LIMITED",
  );
});

test("new in-memory guard instance and reset clear counters and locks", () => {
  const limits = { userMinute: 1, userDaily: 1, globalMinute: 1, globalDaily: 1 };
  const first = new MemoryAiGuards();
  first.consume("classification", "user-a", limits);
  assert.throws(() => first.consume("classification", "user-a", limits));
  first.reset();
  first.consume("classification", "user-a", limits);

  const afterRestart = new MemoryAiGuards();
  afterRestart.consume("classification", "user-a", limits);
});

test("invalid AI environment values fail closed during configuration loading", () => {
  assert.throws(
    () => loadAiConfig({ AI_FEATURE_ENABLED: "yes" }),
    /AI_FEATURE_ENABLED must be true or false/,
  );
  assert.throws(
    () => loadAiConfig({ AI_ANALYSIS_USER_DAILY_LIMIT: "0" }),
    /must be a positive integer/,
  );
  assert.throws(
    () => loadAiConfig({ AI_RETRY_JITTER_MS: "-1" }),
    /must be a non-negative integer/,
  );
});

test("all production AI helpers declare that caller fallback is available", async () => {
  const files = [
    "src/ai/transaction-classification.ts",
    "src/ai/financial-analysis.ts",
    "src/ai/group-payment-analysis.ts",
    "src/ai/group-fund-analysis.ts",
  ];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const calls = source.split("executeStructured({").length - 1;
    const flags = source.split("fallbackOnError: true").length - 1;
    assert.ok(calls > 0, `${file} must call executeStructured`);
    assert.equal(flags, calls, `${file} must mark every AI call as fallback-capable`);
  }
});

test("analysis routes are authorization-gated, aggregate-only and contain no DB writes", async () => {
  const source = await readFile("index.ts", "utf8");
  const routes = [
    ["/api/ai/analyze-personal-ledger", "/api/ai/analyze-group-payments"],
    ["/api/ai/analyze-group-payments", "/api/ai/analyze-group-fund"],
    ["/api/ai/analyze-group-fund", "/api/ai/classify-transaction"],
  ] as const;

  for (const [start, end] of routes) {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.ok(startIndex >= 0 && endIndex > startIndex, `route ${start} must exist`);
    const section = source.slice(startIndex, endIndex);
    assert.match(section, /requireAuthentication/);
    assert.match(section, /isSameOriginAiRequest/);
    assert.doesNotMatch(section, /prisma\.[a-zA-Z]+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/);
    assert.doesNotMatch(section, /select:\s*\{[^}]*rawText\s*:/s);
    assert.doesNotMatch(section, /select:\s*\{[^}]*aiResult\s*:/s);
  }
});

test("classification route keeps AI as suggestion-only and fallback registration remains available", async () => {
  const source = await readFile("index.ts", "utf8");
  const start = source.indexOf('"/api/ai/classify-transaction"');
  const end = source.indexOf('app.post("/app/transactions"', start);
  assert.ok(start >= 0 && end > start);
  const section = source.slice(start, end);
  assert.match(section, /requireAuthentication/);
  assert.match(section, /isSameOriginAiRequest/);
  assert.match(section, /source:\s*"KEYWORD"/);
  assert.match(section, /suggestionToken/);
  assert.doesNotMatch(section, /prisma\.transaction\.(create|createMany|update|upsert|delete)\s*\(/);
});

test("Stage 8 preserves the approved Prisma schema and migration hashes", async () => {
  const schema = await readFile("prisma/schema.prisma");
  assert.equal(
    createHash("sha256").update(schema).digest("hex"),
    "3da4b00d3ade11de08954f43db601f9d56ac22fc8b5238a0acc585b42876b799",
  );

  const migrationRoot = "prisma/migrations";
  const files = await listFilesRecursively(migrationRoot);
  const hashes: string[] = [];
  for (const file of files.sort()) {
    const content = await readFile(file);
    hashes.push(`${createHash("sha256").update(content).digest("hex")}  ${file}\n`);
  }
  assert.equal(
    createHash("sha256").update(hashes.join("")).digest("hex"),
    "9ded588e448291be805833c1fe448a7c13a4118b6d74b9190f929cc4b49e34da",
  );
});


test("environment secrets remain excluded from tracked and release files", async () => {
  const gitignore = await readFile(".gitignore", "utf8");
  assert.match(gitignore, /^\.env$/m);
  assert.match(gitignore, /^\.env\.\*$/m);
  assert.match(gitignore, /^!\.env\.example$/m);

  const example = await readFile(".env.example", "utf8");
  assert.match(example, /^OPENAI_API_KEY=""$/m);
  assert.match(example, /^AI_SAFETY_SALT="replace-with-a-long-random-secret"$/m);
  assert.doesNotMatch(example, /sk-[A-Za-z0-9_-]{16,}/);

  // A developer's local .env is expected to contain real secrets. Verify it is
  // not tracked when Git metadata is available, but never read its contents.
  let trackedEnvironmentFiles: string | null = null;
  try {
    const { stdout } = await execFileAsync("git", ["ls-files", "--", ".env", ".env.local", ".env.development", ".env.production"]);
    trackedEnvironmentFiles = stdout.trim();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      const stderr = String((error as { stderr?: string }).stderr || "");
      assert.match(stderr, /not a git repository/i);
    }
  }
  if (trackedEnvironmentFiles !== null) {
    assert.equal(trackedEnvironmentFiles, "", "local environment files must not be tracked by Git");
  }

  const files = (await listFilesRecursively(".")).filter((file) => {
    const normalized = file.split(path.sep).join("/").replace(/^\.\//, "");
    if (normalized === "node_modules" || normalized.startsWith("node_modules/")) return false;
    if (normalized === ".git" || normalized.startsWith(".git/")) return false;
    if (isLocalEnvironmentFile(normalized)) return false;
    return true;
  });

  for (const file of files) {
    if (file.endsWith("package-lock.json") || file.endsWith(".zip")) continue;
    const content = await readFile(file, "utf8").catch(() => "");
    assert.doesNotMatch(content, /sk-[A-Za-z0-9_-]{16,}/, `secret-like API key found in ${file}`);
  }
});

test("package and lock keep only approved AI packages and public registry URLs", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    dependencies: Record<string, string>;
    scripts: Record<string, string>;
  };
  assert.equal(packageJson.dependencies.openai, "6.46.0");
  assert.equal(packageJson.dependencies.zod, "4.4.3");
  assert.equal(packageJson.scripts["test:ai"], "tsx --test tests/*.test.ts");

  const lockText = await readFile("package-lock.json", "utf8");
  const resolvedUrls = [...lockText.matchAll(/"resolved":\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(resolvedUrls.length > 0);
  assert.equal(resolvedUrls.every((url) => url.startsWith("https://registry.npmjs.org/")), true);
});

function isLocalEnvironmentFile(file: string): boolean {
  const basename = path.posix.basename(file);
  return basename === ".env" || (basename.startsWith(".env.") && basename !== ".env.example");
}

async function listFilesRecursively(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFilesRecursively(fullPath)));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}
