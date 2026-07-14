import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

const getRouteSource = (startMarker: string, endMarker: string) => {
  const start = indexSource.indexOf(startMarker);
  const end = indexSource.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing route marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing route end marker: ${endMarker}`);
  return indexSource.slice(start, end);
};

test("Stage 9-3 personal ledger transactions progress chronologically from carryover to balance", () => {
  const route = getRouteSource('app.get("/app"', 'app.post("/app/pages"');
  assert.match(
    route,
    /orderBy:\s*\[\s*\{ transactionDate: "asc" \},\s*\{ createdAt: "asc" \},\s*\{ id: "asc" \}\s*\]/,
  );
  assert.doesNotMatch(route, /transactionDate: "desc"/);
});

test("Stage 9-3 fund ledger transactions progress chronologically from carryover to balance", () => {
  const route = getRouteSource(
    'app.get("/groups/:groupId/fund"',
    '"/groups/:groupId/fund/pages"',
  );
  assert.match(
    route,
    /orderBy:\s*\[\s*\{ transactionDate: "asc" \},\s*\{ createdAt: "asc" \},\s*\{ id: "asc" \},?\s*\]/,
  );
  assert.doesNotMatch(route, /transactionDate: "desc"/);
});
