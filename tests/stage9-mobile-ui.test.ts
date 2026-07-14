import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Stage 9-6 exposes a tap-expandable compact group navigation without changing personal logout-only navigation", async () => {
  const [header, shellCss] = await Promise.all([
    read("views/partials/app-header.ejs"),
    read("public/css/app-shell.css"),
  ]);
  assert.match(header, /data-app-header-menu-toggle/);
  assert.match(header, /data-app-header-nav/);
  assert.match(header, /matchMedia\("\(max-width: 820px\)"\)/);
  assert.match(header, /navigation\.hidden/);
  assert.match(shellCss, /\.app-header__menu-toggle/);
  assert.match(shellCss, /\.app-header__nav\[hidden\]/);
  assert.match(header, /header\.mode === "personal"[\s\S]*action="\/logout"/);
});

test("Stage 9-6 uses horizontal operation bars with up-down toggle icons and visible mobile labels", async () => {
  const [dashboard, fund, payments, shellCss] = await Promise.all([
    read("views/dashboard.ejs"),
    read("views/fund.ejs"),
    read("views/payments.ejs"),
    read("public/css/app-shell.css"),
  ]);
  for (const view of [dashboard, fund, payments]) {
    assert.match(view, /ledger-operation-button/);
    assert.match(view, /data-operation-mobile-icon/);
    assert.match(view, /[↑↓]/);
    assert.match(view, /ページ追加/);
    assert.match(view, /ページ削除/);
  }
  assert.match(shellCss, /\.ledger-operation-label/);
  assert.match(shellCss, /min-height: 48px !important/);
});

test("Stage 9-6 orders personal and fund mobile cards by the confirmed usage sequence", async () => {
  const [ledgerCss, fundCss, shellCss] = await Promise.all([
    read("public/css/ledger.css"),
    read("public/css/fund.css"),
    read("public/css/app-shell.css"),
  ]);
  assert.match(shellCss, /\.ledger-shell-top,[\s\S]*\.ledger-shell-lower[\s\S]*display: contents/);
  assert.match(ledgerCss, /\.personal-operation-rail\s*\{[\s\S]*order: 1/);
  assert.match(ledgerCss, /\.personal-context-column\s*\{[\s\S]*order: 2/);
  assert.match(ledgerCss, /\.personal-title-card\s*\{[\s\S]*order: 3/);
  assert.match(ledgerCss, /\.personal-collapsed-column,[\s\S]*order: 4/);
  assert.match(ledgerCss, /\.personal-summary-card\s*\{[\s\S]*order: 5/);
  assert.match(ledgerCss, /\.personal-insight-card\s*\{[\s\S]*order: 6/);
  assert.match(ledgerCss, /\.personal-transaction-panel,[\s\S]*order: 7/);
  assert.match(fundCss, /\.fund-operation-rail\s*\{[\s\S]*order: 1/);
  assert.match(fundCss, /\.fund-title-card\s*\{[\s\S]*order: 3/);
  assert.match(fundCss, /\.fund-transaction-panel,[\s\S]*order: 7/);
});

test("Stage 9-6 orders related-payment mobile cards with latest batch before calculation methods", async () => {
  const paymentsCss = await read("public/css/payments.css");
  assert.match(paymentsCss, /\.payments-operation-rail\s*\{[\s\S]*order: 1/);
  assert.match(paymentsCss, /\.payments-context-column,[\s\S]*order: 2/);
  assert.match(paymentsCss, /\.payments-title-card\s*\{[\s\S]*order: 3/);
  assert.match(paymentsCss, /\.payments-latest-batch,[\s\S]*order: 4/);
  assert.match(paymentsCss, /\.payments-method-area\s*\{[\s\S]*order: 5/);
  assert.match(paymentsCss, /\.payments-insight-card\s*\{[\s\S]*order: 6/);
  assert.match(paymentsCss, /\.payments-history-panel\s*\{[\s\S]*order: 7/);
});

test("Stage 9-6 converts personal and fund five-column ledgers into mobile transaction cards without horizontal scrolling", async () => {
  const [dashboard, fund, ledgerCss, fundCss] = await Promise.all([
    read("views/dashboard.ejs"),
    read("views/fund.ejs"),
    read("public/css/ledger.css"),
    read("public/css/fund.css"),
  ]);
  assert.match(dashboard, /isIncomeTransaction \? 'is-income-row' : 'is-expense-row'/);
  assert.match(fund, /isIncomeTransaction \? 'is-income-row' : 'is-expense-row'/);
  assert.match(ledgerCss, /grid-template-areas:[\s\S]*"date date"[\s\S]*"content amount"/);
  assert.match(ledgerCss, /\.personal-ledger-column-heading\s*\{[\s\S]*display: none/);
  assert.match(fundCss, /grid-template-areas:[\s\S]*"date date"[\s\S]*"content amount"/);
  assert.match(fundCss, /\.fund-ledger-column-heading\s*\{[\s\S]*display: none/);
});

test("Stage 9-6 keeps large overlays and page dialogs usable at mobile viewport size", async () => {
  const [transactionCss, ledgerCss, fundCss, paymentsCss] = await Promise.all([
    read("public/css/transaction-overlay.css"),
    read("public/css/ledger.css"),
    read("public/css/fund.css"),
    read("public/css/payments.css"),
  ]);
  assert.match(transactionCss, /width: 100vw;[\s\S]*height: 100dvh/);
  assert.match(ledgerCss, /\.personal-dialog\s*\{[\s\S]*width: 100vw;[\s\S]*height: 100dvh/);
  assert.match(fundCss, /\.fund-page-dialog\s*\{[\s\S]*width: 100vw;[\s\S]*height: 100dvh/);
  assert.match(paymentsCss, /\.payments-page-dialog,[\s\S]*\.ai-analysis-dialog[\s\S]*width: 100vw;[\s\S]*height: 100dvh/);
});
