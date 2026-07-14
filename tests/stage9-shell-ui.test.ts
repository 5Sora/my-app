import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ejs from "ejs";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const renderHeader = async (header: Record<string, unknown>) => {
  const source = await read("views/partials/app-header.ejs");
  return ejs.render(source, { header }, {
    filename: new URL("../views/partials/app-header.ejs", import.meta.url).pathname,
  });
};

test("Stage 9-1 uses one shared sticky header on personal and group pages", async () => {
  const [dashboard, group, fund, payments, shellCss] = await Promise.all([
    read("views/dashboard.ejs"),
    read("views/group.ejs"),
    read("views/fund.ejs"),
    read("views/payments.ejs"),
    read("public/css/app-shell.css"),
  ]);

  for (const view of [dashboard, group, fund, payments]) {
    assert.match(view, /partials\/app-header/);
    assert.match(view, /\/css\/app-shell\.css/);
    assert.doesNotMatch(view, /<header class="ledger-header">/);
  }

  assert.match(shellCss, /\.app-header\s*\{[\s\S]*position: sticky/);
  assert.match(shellCss, /\.app-header\s*\{[\s\S]*z-index: 100/);
  assert.match(shellCss, /\.app-header__inner\s*\{[\s\S]*justify-content: flex-end/);
});

test("personal header exposes logout only while group header exposes the confirmed navigation", async () => {
  const personal = await renderHeader({
    mode: "personal",
    eyebrow: "個人家計簿",
    title: "テストの家計簿",
    subtitle: "全期間",
  });
  assert.match(personal, />ログアウト</);
  assert.doesNotMatch(personal, /app-header__identity/);
  assert.doesNotMatch(personal, /テストの家計簿/);
  assert.doesNotMatch(personal, />概要</);
  assert.doesNotMatch(personal, />基金</);
  assert.doesNotMatch(personal, />関連支払い</);
  assert.doesNotMatch(personal, />自分の家計簿</);

  const group = await renderHeader({
    mode: "group",
    eyebrow: "グループ基金",
    title: "テストグループ",
    subtitle: "全期間",
    groupId: "group-1",
    active: "fund",
    fundHref: "/groups/group-1/fund?pageId=page-1",
  });
  for (const label of ["自分の家計簿", "概要", "基金", "関連支払い", "ログアウト"]) {
    assert.match(group, new RegExp(`>${label}<`));
  }
  assert.doesNotMatch(group, /app-header__identity/);
  assert.doesNotMatch(group, /テストグループ/);
  assert.match(group, /aria-current="page" data-fund-context-link/);
  assert.match(group, /\["success", "error"\]/);
  assert.match(group, /searchParams\.delete\(key\)/);
});

test("fund page uses the shared three-part top shell and 12-column lower shell", async () => {
  const [fund, shellCss] = await Promise.all([
    read("views/fund.ejs"),
    read("public/css/app-shell.css"),
  ]);

  assert.match(fund, /class="ledger-shell fund-shell"/);
  assert.match(fund, /class="ledger-shell-top fund-shell-top"/);
  assert.match(fund, /class="ledger-shell-lower fund-layout/);
  assert.match(fund, /class="[^"]*fund-title-card[^"]*"/);
  assert.match(fund, /class="[^"]*fund-summary-card[^"]*"/);
  assert.match(fund, /class="[^"]*fund-insight-card[^"]*"/);
  assert.doesNotMatch(fund, /基金状態/);
  assert.doesNotMatch(fund, /page\.startDate \|\| page\.endDate/);
  assert.match(fund, /class="fund-ledger"/);
  assert.match(fund, /data-fund-context-toggle/);

  assert.match(shellCss, /grid-template-columns: repeat\(12, minmax\(0, 1fr\)\)/);
  assert.match(shellCss, /\.ledger-shell-top > \.panel \{[\s\S]*grid-column: span 4/);
  assert.match(shellCss, /\.fund-body\s*\{[\s\S]*overflow: hidden/);
  assert.match(shellCss, /\.fund-context-column\s*\{[\s\S]*grid-template-rows: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(shellCss, /\.fund-page-panel \.page-list,[\s\S]*overflow-y: auto/);
  assert.match(shellCss, /\.fund-operation-rail\s*\{[\s\S]*grid-template-rows: repeat\(4, minmax\(48px, 1fr\)\)/);

  const fundCss = await read("public/css/fund.css");
  assert.match(fundCss, /Stage 9-1C: compact context lists/);
  assert.match(fundCss, /\.fund-page-panel \.page-list a\s*\{[\s\S]*border-left: 3px solid transparent/);
  assert.match(fundCss, /\.fund-member-list li\s*\{[\s\S]*border-bottom: 1px solid var\(--border\)/);
});
