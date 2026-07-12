import type { AiFeature, AiFeatureLimits } from "./config.js";
import { AiError } from "./errors.js";

type CounterWindow = "minute" | "daily";
type CounterScope = "user" | "global";

type CounterEntry = {
  count: number;
  expiresAt: number;
};

export class MemoryAiGuards {
  private readonly counters = new Map<string, CounterEntry>();
  private readonly locks = new Set<string>();
  private operationsSinceCleanup = 0;

  constructor(private readonly now: () => number = Date.now) {}

  acquireLock(feature: AiFeature, anonymousUserKey: string): () => void {
    const key = `${feature}:${anonymousUserKey}`;
    if (this.locks.has(key)) {
      throw new AiError("CONCURRENT_REQUEST");
    }
    this.locks.add(key);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.locks.delete(key);
    };
  }

  consume(
    feature: AiFeature,
    anonymousUserKey: string,
    limits: AiFeatureLimits,
  ): void {
    const now = this.now();
    const minuteStart = Math.floor(now / 60_000) * 60_000;
    const minuteExpiry = minuteStart + 60_000;
    const dailyKey = formatTokyoDate(now);
    const dailyExpiry = nextTokyoMidnight(now);

    const checks = [
      this.counterSpec(
        "user",
        "minute",
        feature,
        anonymousUserKey,
        String(minuteStart),
        minuteExpiry,
        limits.userMinute,
      ),
      this.counterSpec(
        "user",
        "daily",
        feature,
        anonymousUserKey,
        dailyKey,
        dailyExpiry,
        limits.userDaily,
      ),
      this.counterSpec(
        "global",
        "minute",
        feature,
        "all",
        String(minuteStart),
        minuteExpiry,
        limits.globalMinute,
      ),
      this.counterSpec(
        "global",
        "daily",
        feature,
        "all",
        dailyKey,
        dailyExpiry,
        limits.globalDaily,
      ),
    ];

    for (const item of checks) {
      const current = this.readCount(item.key, now);
      if (current >= item.limit) {
        throw new AiError("RATE_LIMITED");
      }
    }

    for (const item of checks) {
      const current = this.readCount(item.key, now);
      this.counters.set(item.key, {
        count: current + 1,
        expiresAt: item.expiresAt,
      });
    }

    this.operationsSinceCleanup += 1;
    if (this.operationsSinceCleanup >= 100) {
      this.cleanup(now);
      this.operationsSinceCleanup = 0;
    }
  }

  reset(): void {
    this.counters.clear();
    this.locks.clear();
    this.operationsSinceCleanup = 0;
  }

  private counterSpec(
    scope: CounterScope,
    window: CounterWindow,
    feature: AiFeature,
    subject: string,
    bucket: string,
    expiresAt: number,
    limit: number,
  ) {
    return {
      key: `${scope}:${window}:${feature}:${subject}:${bucket}`,
      expiresAt,
      limit,
    };
  }

  private readCount(key: string, now: number): number {
    const entry = this.counters.get(key);
    if (!entry) return 0;
    if (entry.expiresAt <= now) {
      this.counters.delete(key);
      return 0;
    }
    return entry.count;
  }

  private cleanup(now: number): void {
    for (const [key, entry] of this.counters) {
      if (entry.expiresAt <= now) this.counters.delete(key);
    }
  }
}

function formatTokyoDate(timestamp: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

function nextTokyoMidnight(timestamp: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const utcAtTokyoMidnight = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day) + 1,
    -9,
    0,
    0,
    0,
  );
  return utcAtTokyoMidnight;
}
