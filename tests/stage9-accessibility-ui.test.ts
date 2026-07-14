import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Stage 9-7 loads one shared accessibility and UI-state layer on application screens", async () => {
  const views = await Promise.all([
    read("views/dashboard.ejs"),
    read("views/fund.ejs"),
    read("views/payments.ejs"),
    read("views/group.ejs"),
    read("views/payment-confirm.ejs"),
  ]);
  for (const view of views) {
    assert.match(view, /\/css\/ui-states\.css/);
    assert.match(view, /\/js\/ui-accessibility\.js/);
  }
});

test("Stage 9-7 gives all page and overlay dialogs modal names and shared focus containment", async () => {
  const [dashboard, fund, payments, aiPartial, transactionPartial, script] = await Promise.all([
    read("views/dashboard.ejs"),
    read("views/fund.ejs"),
    read("views/payments.ejs"),
    read("views/partials/ai-analysis-dialog.ejs"),
    read("views/partials/transaction-add-overlay.ejs"),
    read("public/js/ui-accessibility.js"),
  ]);
  for (const source of [dashboard, fund, payments, aiPartial, transactionPartial]) {
    assert.match(source, /aria-modal="true"/);
    assert.match(source, /aria-labelledby=/);
  }
  const group = await read("views/group.ejs");
  assert.match(group, /class="group-dialog" aria-modal="true" aria-labelledby=/);
  assert.match(group, /data-close-dialog/);
  assert.match(script, /event\.key !== "Tab"/);
  assert.match(script, /openerByDialog/);
  assert.match(script, /focusDialog/);
  assert.match(script, /body\.dataset\.modalOpen/);
});

test("Stage 9-7 links browser validation failures to fields and an assertive summary", async () => {
  const [script, css] = await Promise.all([
    read("public/js/ui-accessibility.js"),
    read("public/css/ui-states.css"),
  ]);
  assert.match(script, /addEventListener\("invalid"/);
  assert.match(script, /aria-invalid/);
  assert.match(script, /aria-describedby/);
  assert.match(script, /dataUiValidationSummary|uiValidationSummary/);
  assert.match(script, /resetValidationState/);
  assert.match(script, /appUiResetValidation/);
  assert.match(css, /\.ui-validation-summary/);
  assert.match(css, /\.ui-field-error/);
  assert.match(css, /\[aria-invalid="true"\]/);
});

test("Stage 9-7 standardizes success, error, warning, fallback, loading, disabled, and reduced-motion states", async () => {
  const [css, dashboard, payments, transactionScript, analysisScript] = await Promise.all([
    read("public/css/ui-states.css"),
    read("views/dashboard.ejs"),
    read("views/payments.ejs"),
    read("public/js/transaction-overlay.js"),
    read("public/js/ai-analysis-dialog.js"),
  ]);
  for (const state of ["success", "error", "warning", "fallback", "loading"]) {
    assert.match(css, new RegExp(`data-ui-state=\\"${state}\\"`));
  }
  assert.match(css, /\[aria-disabled="true"\]/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(dashboard, /data-ui-state="error"/);
  assert.match(payments, /data-ui-state="fallback"/);
  assert.match(transactionScript, /dataset\.uiState/);
  assert.match(analysisScript, /dataset\.uiState = "loading"/);
  assert.match(analysisScript, /classList\.toggle\("is-loading", busy\)/);
  assert.match(css, /@keyframes ui-spinner/);
});

test("Stage 9-7 visibly disables dialog exits while a confirmation or registration is submitting", async () => {
  const [common, transaction, condition, preview] = await Promise.all([
    read("public/js/ui-accessibility.js"),
    read("public/js/transaction-overlay.js"),
    read("public/js/payment-condition-overlay.js"),
    read("public/js/payment-preview-overlay.js"),
  ]);
  assert.match(common, /form\[data-submitting='true'\]/);
  assert.match(common, /処理中のため、この画面は閉じられません/);
  assert.match(transaction, /closeButtons[\s\S]*button\.disabled = true/);
  assert.match(condition, /syncSubmitting/);
  assert.match(preview, /dialog\.setAttribute\("aria-busy"/);
});
