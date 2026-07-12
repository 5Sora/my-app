import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  BadRequestError,
  PermissionDeniedError,
  RateLimitError,
} from "openai";

export type AiErrorCode =
  | "FEATURE_DISABLED"
  | "CONFIGURATION_ERROR"
  | "RATE_LIMITED"
  | "CONCURRENT_REQUEST"
  | "TIMEOUT"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_SERVER_ERROR"
  | "PROVIDER_AUTH_ERROR"
  | "PROVIDER_REQUEST_ERROR"
  | "PROVIDER_NETWORK_ERROR"
  | "SCHEMA_ERROR"
  | "PROVIDER_ERROR";

const PUBLIC_MESSAGES: Record<AiErrorCode, string> = {
  FEATURE_DISABLED: "AI機能を現在利用できません。",
  CONFIGURATION_ERROR: "AI機能を現在利用できません。",
  RATE_LIMITED: "本日の利用上限、または短時間の利用上限に達しました。",
  CONCURRENT_REQUEST: "同じAI処理を実行中です。完了後にもう一度お試しください。",
  TIMEOUT: "AIとの通信が時間切れになりました。",
  PROVIDER_RATE_LIMIT: "AI機能が混み合っています。時間をおいてお試しください。",
  PROVIDER_SERVER_ERROR: "AI機能を現在利用できません。",
  PROVIDER_AUTH_ERROR: "AI機能を現在利用できません。",
  PROVIDER_REQUEST_ERROR: "AI機能を現在利用できません。",
  PROVIDER_NETWORK_ERROR: "AI機能を現在利用できません。",
  SCHEMA_ERROR: "AIの応答を正しく処理できませんでした。",
  PROVIDER_ERROR: "AI機能を現在利用できません。",
};

const HTTP_STATUS: Record<AiErrorCode, number> = {
  FEATURE_DISABLED: 503,
  CONFIGURATION_ERROR: 503,
  RATE_LIMITED: 429,
  CONCURRENT_REQUEST: 409,
  TIMEOUT: 504,
  PROVIDER_RATE_LIMIT: 502,
  PROVIDER_SERVER_ERROR: 502,
  PROVIDER_AUTH_ERROR: 502,
  PROVIDER_REQUEST_ERROR: 502,
  PROVIDER_NETWORK_ERROR: 502,
  SCHEMA_ERROR: 502,
  PROVIDER_ERROR: 502,
};

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;

  constructor(
    code: AiErrorCode,
    options: { message?: string; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(options.message || PUBLIC_MESSAGES[code], { cause: options.cause });
    this.name = "AiError";
    this.code = code;
    this.httpStatus = HTTP_STATUS[code];
    this.retryable = options.retryable ?? false;
  }
}

export type PublicAiError = {
  code: AiErrorCode;
  message: string;
  status: number;
};

export function toPublicAiError(error: unknown): PublicAiError {
  const aiError = error instanceof AiError ? error : normalizeProviderError(error);
  return {
    code: aiError.code,
    message: PUBLIC_MESSAGES[aiError.code],
    status: aiError.httpStatus,
  };
}

export function normalizeProviderError(
  error: unknown,
  localTimeout = false,
): AiError {
  if (error instanceof AiError) return error;

  if (localTimeout || error instanceof APIConnectionTimeoutError) {
    return new AiError("TIMEOUT", { retryable: true, cause: error });
  }
  if (error instanceof RateLimitError) {
    return new AiError("PROVIDER_RATE_LIMIT", {
      retryable: true,
      cause: error,
    });
  }
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    return new AiError("PROVIDER_AUTH_ERROR", { cause: error });
  }
  if (error instanceof BadRequestError) {
    return new AiError("PROVIDER_REQUEST_ERROR", { cause: error });
  }
  if (error instanceof APIConnectionError) {
    return new AiError("PROVIDER_NETWORK_ERROR", {
      retryable: true,
      cause: error,
    });
  }
  if (error instanceof APIError) {
    if (error.status === 429) {
      return new AiError("PROVIDER_RATE_LIMIT", {
        retryable: true,
        cause: error,
      });
    }
    if (typeof error.status === "number" && error.status >= 500) {
      return new AiError("PROVIDER_SERVER_ERROR", {
        retryable: true,
        cause: error,
      });
    }
    if (error.status === 400) {
      return new AiError("PROVIDER_REQUEST_ERROR", { cause: error });
    }
    if (error.status === 401 || error.status === 403) {
      return new AiError("PROVIDER_AUTH_ERROR", { cause: error });
    }
  }

  if (isStatusError(error, 429)) {
    return new AiError("PROVIDER_RATE_LIMIT", {
      retryable: true,
      cause: error,
    });
  }
  if (hasServerStatus(error)) {
    return new AiError("PROVIDER_SERVER_ERROR", {
      retryable: true,
      cause: error,
    });
  }
  if (isStatusError(error, 400)) {
    return new AiError("PROVIDER_REQUEST_ERROR", { cause: error });
  }
  if (isStatusError(error, 401) || isStatusError(error, 403)) {
    return new AiError("PROVIDER_AUTH_ERROR", { cause: error });
  }

  return new AiError("PROVIDER_ERROR", { cause: error });
}

function isStatusError(error: unknown, status: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === status
  );
}

function hasServerStatus(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return false;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && status >= 500;
}
