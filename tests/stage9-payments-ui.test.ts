import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Stage 9-5 payments page uses the shared three-card top shell and open/closed 12-column lower shell", async () => {
  const [view, css] = await Promise.all([read("views/payments.ejs"), read("public/css/payments.css")]);
  assert.match(view, /ledger-shell payments-shell/);
  assert.match(view, /ledger-shell-top payments-shell-top/);
  assert.match(view, /payments-title-card/);
  assert.match(view, /payments-method-area/);
  assert.match(view, /payments-insight-card/);
  assert.match(css, /payments-lower-area[\s\S]*grid-template-columns: repeat\(12, minmax\(0, 1fr\)\)/);
  assert.match(css, /payments-context-column[\s\S]*grid-column: 1 \/ span 3/);
  assert.match(css, /payments-operation-rail[\s\S]*grid-column: 4/);
  assert.match(css, /payments-history-panel[\s\S]*grid-column: 5 \/ -1/);
  assert.doesNotMatch(view, /payments-result-column/);
});

test("Stage 9-5 shows a selected-period member payment share chart and AI analysis in the upper-right card", async () => {
  const [view, script] = await Promise.all([read("views/payments.ejs"), read("public/js/payment-charts.js")]);
  assert.match(view, /メンバー別支払額割合/);
  assert.match(view, /選択期間に記録された支払額の割合/);
  assert.match(view, /data-payment-share-chart/);
  assert.match(view, /data-payment-share-segments/);
  assert.match(view, /data-ai-analysis-button/);
  assert.match(script, /data-payment-share-chart-data/);
  assert.match(script, /pointerenter/);
  assert.match(script, /focus/);
  assert.match(script, /click/);
});

test("Stage 9-5 moves the latest confirmed batch into the closed 3-of-12 card and keeps history in the right 8-of-12", async () => {
  const view = await read("views/payments.ejs");
  assert.match(view, /payments-latest-batch/);
  assert.match(view, /最新の確定割り勘/);
  assert.match(view, /直近の割り勘/);
  assert.match(view, /payments-latest-allocation-list/);
  assert.match(view, /payments-history-panel/);
  assert.match(view, /時系列/);
  assert.match(view, /人ごと/);
});

test("Stage 9-5 keeps chronological dates readable and gives content more room than names", async () => {
  const css = await read("public/css/payments.css");
  assert.match(
    css,
    /--chronological-columns: 104px minmax\(150px, 1\.3fr\) 108px minmax\(76px, \.55fr\)/,
  );
  assert.match(
    css,
    /@media \(max-width: 760px\) \{[\s\S]*--chronological-columns: 96px minmax\(128px, 1\.2fr\) 96px minmax\(68px, \.55fr\)/,
  );
});

test("Stage 9-5 renders split preview in a large modal overlay instead of the normal page columns", async () => {
  const [view, css, script] = await Promise.all([
    read("views/payments.ejs"),
    read("public/css/payments.css"),
    read("public/js/payment-preview-overlay.js"),
  ]);
  assert.match(view, /payments-preview-dialog/);
  assert.match(view, /aria-modal="true"/);
  assert.match(view, /割り勘の試算結果/);
  assert.match(view, /算出前比率/);
  assert.match(view, /正確値/);
  assert.match(view, /条件を修正/);
  assert.match(css, /height: min\(820px, calc\(100dvh - 32px\)\)/);
  assert.match(css, /payments-preview-body[\s\S]*overflow-y: auto/);
  assert.match(script, /showModal\(\)/);
  assert.match(script, /dialog\.close\("edit"\)/);
});
