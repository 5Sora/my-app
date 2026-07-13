# my-app

## Setup

```bash
npm ci
npx prisma generate
npm start
```

Copy `.env.example` to `.env` and set the database and session values before starting the application.

## Stage 8-1: common AI foundation

The common AI foundation is implemented under `src/ai/`. Stage 8-1 does not add an AI HTTP route or change an existing transaction route. The classification and analysis routes will connect to this foundation in their respective later stages.

The foundation provides:

- OpenAI Responses API access through the official Node SDK
- Structured Outputs through strict Zod-backed JSON Schema
- server-only API key handling
- separate classification and analysis models
- global and feature-specific flags
- `store: false`
- an HMAC-SHA256 anonymous `safety_identifier`
- total timeout and one limited retry
- normalized provider, timeout, limit, lock, configuration and schema errors
- per-user and global minute/daily in-memory limits
- same-user/same-feature concurrent execution locking
- structured logs that exclude natural-language input, names, login IDs, API keys, session IDs and full AI output

Required AI variables and their default limits are documented in `.env.example`. `AI_SAFETY_SALT` must be a server-side secret independent of `SESSION_SECRET`.

The in-memory counters are suitable only for the current single-instance instructional deployment. They reset on server restart and are not shared by multiple instances.

### AI foundation tests

The tests use a mock Responses API parser and do not call OpenAI.

```bash
npm run test:ai
```

The test suite covers feature flags, missing settings, strict structured output parameters, `store: false`, anonymous identifiers, user/global limits, concurrent locks, retry classification, timeout handling, schema validation and log redaction boundaries.

## Stage 8-2 and 8-3: transaction classification

AI classification is connected to the existing confirmation-first transaction forms. A classification response only fills editable form fields; it does not write a Transaction. The normal registration routes perform the existing authorization and validation before saving.

Stage 8-2 covers personal income and expense. Stage 8-3 extends the same foundation to:

- individual `GROUP_PAYMENT`
- `FUND_INCOME`
- `FUND_EXPENSE`

`FUND_CONTRIBUTION`, `FUND_REFUND`, split-payment inputs, participants, calculation methods and allocation amounts are not AI classification targets.

The classification request sends only the natural-language text plus application-owned instructions such as the Asia/Tokyo reference date and the allowed category list. Names, login IDs, group names, database IDs, membership lists and transaction history are not sent to OpenAI.

Signed suggestion tokens are bound to the user, classification target and group. They expire after 30 minutes. An invalid or mismatched token does not block normal registration; the saved source falls back to manual handling and no AI audit data is stored.

## Stage 8-4: personal ledger AI analysis

The selected personal LedgerPage can be analyzed through an explicit `AI分析` action. The server verifies that the page belongs to the authenticated active user, retrieves only the transaction fields required for aggregation, and calculates all totals in TypeScript before calling OpenAI.

The analysis input contains aggregate values only:

- page period and optional immediately preceding equal-length comparison period
- carryover, income, expense, net and closing balance
- income and expense counts
- category totals and shares
- `GROUP_PAYMENT` and `FUND_CONTRIBUTION` totals
- application-calculated warning flags

Names, login IDs, user/page/transaction IDs, group names, transaction descriptions and individual transaction rows are not sent to OpenAI. The route uses the analysis model and strict Structured Outputs with `store: false`.

Analysis output is displayed temporarily in a dialog and is not written to the database, `Transaction.aiResult`, or the session. If analysis is disabled, rate-limited, times out, or fails validation/provider processing, the same dialog displays an application-generated summary clearly labeled `自動集計（AI分析ではありません）`.

Application warning evidence is calculated before the AI call. The initial warning conditions are a negative period net, an expense increase of at least 20 percent from the comparison period, and a single expense category representing at least 50 percent of expenses. An AI `WARNING` without application evidence is downgraded to `NOTICE` before display.

## Stage 8-5: group payment AI analysis

The selected `GROUP_PAYMENT` LedgerPage can be analyzed through an explicit `AI分析` action available to active group members. The server verifies the active user, membership, group and page before calculating the aggregate in TypeScript.

The analysis input contains aggregate values only:

- period and optional immediately preceding equal-length comparison period
- total amount and Transaction row count
- individual payment count
- distinct confirmed payment batch count
- payment event count (`individual payments + distinct batches`)
- average Transaction amount
- category totals and shares
- application-calculated warning flags

Names, login IDs, user/group/page IDs, `paymentBatchId` values, transaction descriptions, participant lists, participant shares and individual member payment totals are not sent to OpenAI. Fairness, contribution, responsibility, relationships, payment ability and personal economic circumstances are explicitly outside the analysis scope.

The personal and group-payment analysis screens use the same temporary dialog renderer. Analysis output is not saved to the database, `Transaction.aiResult`, or the session. Provider failure, timeout, limits, configuration failure or feature disablement produces an application-generated aggregate summary clearly labeled `自動集計（AI分析ではありません）`.

Application warning evidence for group payments is limited to a total increase of at least 20 percent from the comparison period and a single category representing at least 50 percent of the total. An unsupported AI `WARNING` is downgraded to `NOTICE` before display.


## 第8-6: 基金AI分析

基金画面の選択中LedgerPageで、基金収支、内部拠出、外部収入、返金、支出カテゴリ、匿名化したメンバー別拠出構造を分析できます。OpenAIには実名・userId・rawText・個別Transactionを送らず、リクエストごとに生成した一時的な `MEMBER_n` を使用します。表示前にサーバー側で実名へ戻し、対応表はDB・Session・ログへ保存しません。AIが利用できない場合は自動集計を表示します。


### 第8-6表示補足

基金AI分析では、AI文章とは別にアプリ計算の固定集計欄を表示します。
拠出者数、有効メンバー数、内部拠出依存率、最大拠出割合、上位3名割合はAIが文章で省略しても必ず確認できます。
AIには匿名化方式やmemberKey自体を説明させません。

## Stage 8-7: AI total verification

Stage 8-7 adds cross-stage regression and failure-mode verification without changing the database schema, migrations, or package dependencies.
The current mock/static suite contains 83 tests and does not call the real OpenAI API.

The total AI test suite covers:

- provider 400, 401, 403, 429, temporary 5xx, network failure, timeout, and schema mismatch
- global and feature-specific flags and missing configuration
- per-user and global minute/daily limits
- independent classification and analysis counters and locks
- lock release after success and failure
- restart-equivalent in-memory counter reset
- safe public error messages
- accurate `fallback` logging
- provider token usage logging
- aggregate-only analysis routes with no database writes
- suggestion-only classification routes
- unchanged Prisma schema and migration hashes
- fixed OpenAI SDK and Zod versions with public npm registry lock URLs

All production classification and analysis calls declare their available fallback. Successful requests log `fallback:false`; a failed AI request that is replaced by keyword classification or an automatic aggregate summary logs `fallback:true`.

### Token and cost estimate helper

Capture server output while performing one classification and the three analysis operations:

```bash
npm start 2>&1 | tee stage8-7-ai.log
```

Then calculate an approximate API cost from the structured `ai_request` lines:

```bash
node scripts/stage8-7-log-cost.mjs stage8-7-ai.log
```

The helper uses the standard short-context text token prices published on 2026-07-13:

- `gpt-5.4-nano`: $0.20 / 1M input tokens and $1.25 / 1M output tokens
- `gpt-5.4-mini`: $0.75 / 1M input tokens and $4.50 / 1M output tokens

The estimate is informational. Recheck the current OpenAI pricing page before relying on it for budgeting.
