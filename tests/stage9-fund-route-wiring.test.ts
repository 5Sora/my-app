import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readIndex = () => readFile(new URL("../index.ts", import.meta.url), "utf8");

test("Stage 9-2 builds fund visualization inside the fund GET route and passes it to fund.ejs", async () => {
  const source = await readIndex();
  const fundRenderIndex = source.indexOf('res.render("fund", {');
  const dashboardRenderIndex = source.indexOf('res.render("dashboard", {');

  assert.notEqual(fundRenderIndex, -1);
  assert.notEqual(dashboardRenderIndex, -1);

  const fundRouteWindow = source.slice(Math.max(0, fundRenderIndex - 3500), fundRenderIndex + 1800);
  const dashboardRouteWindow = source.slice(Math.max(0, dashboardRenderIndex - 2500), dashboardRenderIndex + 1300);

  assert.match(fundRouteWindow, /const fundVisualization = buildFundVisualization\(transactions\);/);
  assert.match(fundRouteWindow, /res\.render\("fund", \{[\s\S]*fundVisualization,/);
  assert.doesNotMatch(dashboardRouteWindow, /buildFundVisualization\(transactions\)/);
  assert.doesNotMatch(dashboardRouteWindow, /fundVisualization,/);
});
