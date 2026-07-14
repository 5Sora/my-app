import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Stage 9-7A does not trigger validation while calculating initial button availability", async () => {
  const payments = await read("views/payments.ejs");
  assert.doesNotMatch(payments, /previewSubmit\.disabled = !\(splitForm\.checkValidity\(\)/);
  assert.match(payments, /previewSubmit\.disabled = !\(hasParticipant && hasMethod\)/);
});

test("Stage 9-7A clears generated validation UI whenever a dialog closes or reopens", async () => {
  const [common, condition, transaction] = await Promise.all([
    read("public/js/ui-accessibility.js"),
    read("public/js/payment-condition-overlay.js"),
    read("public/js/transaction-overlay.js"),
  ]);
  assert.match(common, /resetValidationState\(dialog\)/);
  assert.match(common, /querySelectorAll\("\[data-ui-validation-summary\]\"\)/);
  assert.match(condition, /appUiResetValidation/);
  assert.match(transaction, /appUiResetValidation/);
});

test("Stage 9-7A shows a visible blue spinner while AI analysis is running", async () => {
  const [script, css] = await Promise.all([
    read("public/js/ai-analysis-dialog.js"),
    read("public/css/ui-states.css"),
  ]);
  assert.match(script, /button\.classList\.toggle\("is-loading", busy\)/);
  assert.match(script, /button\.setAttribute\("aria-busy", String\(busy\)\)/);
  assert.match(css, /\[data-ai-analysis-button\]\.is-loading::before/);
  assert.match(css, /@keyframes ui-spinner/);
});
