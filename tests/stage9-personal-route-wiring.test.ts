import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

test("Stage 9-3 builds personal visualization in the personal GET route and preserves temporary context state", () => {
  const start = indexSource.indexOf('app.get("/app"');
  const end = indexSource.indexOf('app.post("/app/pages"', start);
  const route = indexSource.slice(start, end);
  assert.match(route, /buildPersonalVisualization\(transactions\)/);
  assert.match(route, /personalVisualization,/);
  assert.match(route, /contextState,/);
  assert.match(route, /isContextOpen: contextState === "open"/);
  assert.match(indexSource, /function parsePersonalContextState/);
  assert.match(indexSource, /if \(options\.contextState === "open"\)/);
});
