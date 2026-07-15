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
  assert.match(view, /メンバー別支払い額割合/);
  assert.doesNotMatch(view, /公平性の判定ではなく/);
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
  assert.doesNotMatch(view, /最新の確定割り勘/);
  assert.match(view, /直近の割り勘/);
  assert.match(view, /payments-latest-allocation-list/);
  assert.match(view, /payments-history-panel/);
  assert.match(view, /id="payment-history-heading">履歴詳細/);
  assert.match(view, /<span>内容<\/span>/);
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


test("final split-payment UI uses unified naming, panel titles, and a full-panel mint guide", async () => {
  const [view, css, overlay] = await Promise.all([
    read("views/payments.ejs"),
    read("public/css/payments.css"),
    read("views/partials/transaction-add-overlay.ejs"),
  ]);
  assert.match(view, /<%= group\.name %> の割り勘/);
  assert.match(view, /id="calculation-method-heading">割り勘の算出/);
  assert.doesNotMatch(view, /payments-member-history-label/);
  assert.doesNotMatch(view, />履歴<\/span>/);
  assert.match(view, />所属メンバー</);
  assert.doesNotMatch(view, /member\.role === "ADMIN" \? "管理者" : "メンバー"/);
  assert.doesNotMatch(view, /member\.userId === currentUserId \? "・あなた"/);
  assert.match(view, /data-calculation-member-guide/);
  assert.match(view, /data-calculation-method-guide/);
  assert.match(view, /複数人で割り勘する場合は、「割り勘の算出」パネルの「割り勘を開始」から操作してください。/);
  assert.match(overlay, /Array\.isArray\(overlay\.notes\)/);
  assert.match(css, /is-calculation-mode \.payments-method-area,[\s\S]*\.is-calculation-mode \.payments-member-panel[\s\S]*border-color: #58d993/);
  assert.match(css, /box-shadow:[\s\S]*rgb\(75 225 145 \/ 42%\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\.payments-member-list li \{[\s\S]*grid-template-columns: 42px minmax\(0, 1fr\)/);
  assert.match(css, /\.payments-member-action \{[\s\S]*width: 42px;[\s\S]*min-width: 42px;[\s\S]*background: transparent;[\s\S]*pointer-events: none/);
  assert.match(css, /\.payments-member-action::before \{[\s\S]*width: 16px;[\s\S]*height: 16px;[\s\S]*border: 1\.5px solid #8d8882;[\s\S]*border-radius: 50%/);
  assert.match(css, /\.is-calculation-mode \.payments-member-action \{[\s\S]*background: #f4f1ed;[\s\S]*pointer-events: auto/);
  assert.match(css, /\.is-calculation-mode \.payments-member-action::before \{[\s\S]*display: none/);
  assert.match(css, /\.payments-member-list\.ledger-context-list > li \{[\s\S]*grid-template-columns: 42px minmax\(0, 1fr\);[\s\S]*column-gap: 10px/);
  assert.match(css, /\.payments-member-name strong \{[\s\S]*text-overflow: ellipsis;[\s\S]*white-space: nowrap/);
});
