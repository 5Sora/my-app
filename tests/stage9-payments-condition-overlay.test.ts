import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Stage 9-5A keeps method explanations in one fixed summary region without expanding method cards", async () => {
  const [view, css] = await Promise.all([
    read("views/payments.ejs"),
    read("public/css/payments.css"),
  ]);

  assert.match(view, /id="payment-method-summary"/);
  assert.match(view, /data-method-description=/);
  assert.match(view, /pointerenter/);
  assert.doesNotMatch(view, /payments-method-description/);
  assert.match(css, /payments-method-summary[\s\S]*max-height: 72px[\s\S]*overflow-y: auto/);
});

test("Stage 9-5A moves payment amount, date, description, and category into a large condition dialog", async () => {
  const [view, css, script] = await Promise.all([
    read("views/payments.ejs"),
    read("public/css/payments.css"),
    read("public/js/payment-condition-overlay.js"),
  ]);

  assert.match(view, /payments-condition-dialog/);
  assert.match(view, /aria-modal="true"/);
  assert.match(view, /data-open-payment-conditions/);
  assert.match(view, /<form id="split-preview-form"[\s\S]*payments-condition-form/);
  assert.match(view, /支払い総額/);
  assert.match(view, /実際の取引日/);
  assert.match(view, /内容・名目/);
  assert.match(view, /カテゴリ/);
  assert.match(css, /height: min\(720px, calc\(100dvh - 32px\)\)/);
  assert.match(css, /payments-condition-body[\s\S]*overflow-y: auto/);
  assert.match(script, /showModal\(\)/);
  assert.match(script, /payments:selection-updated/);
});

test("Stage 9-5A returns from preview editing to the condition dialog instead of the cramped top card", async () => {
  const script = await read("public/js/payment-preview-overlay.js");
  assert.match(script, /payments:open-condition-dialog/);
  assert.doesNotMatch(script, /scrollIntoView/);
});
