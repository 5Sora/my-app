# my-app

A personal and group accounting web application with period-based ledgers, group funds, history-aware split calculations, AI-assisted transaction classification, and aggregate financial analysis.

## Setup

```bash
npm ci
npx prisma generate
npm start
```

Copy `.env.example` to `.env`, then configure the database, session, and optional AI settings before starting the application.

## Testing

The automated test suite uses mocked AI responses and does not call the live OpenAI API.

```bash
npm run test:ai
```

The current suite contains 143 tests covering AI infrastructure, transaction classification, financial analysis, authorization boundaries, visualization aggregation, split calculations, responsive UI behavior, validation state, accessibility, and demo-data integrity.

## AI Architecture

### Stage 8-1: Common AI Foundation

The shared AI infrastructure is implemented under `src/ai/`. It provides:

- OpenAI Responses API access through the official Node SDK
- Structured Outputs backed by strict Zod schemas
- server-only API key handling
- separate classification and analysis models
- global and feature-specific flags
- `store: false`
- an HMAC-SHA256 anonymous `safety_identifier`
- total request timeouts and one limited retry
- normalized provider, timeout, limit, lock, configuration, and schema errors
- per-user and global minute/daily in-memory limits
- same-user, same-feature concurrency locks
- structured logs that exclude natural-language input, names, login IDs, API keys, session IDs, and full AI output

Required AI variables and their default limits are documented in `.env.example`. `AI_SAFETY_SALT` must be a server-side secret independent of `SESSION_SECRET`.

The in-memory counters are appropriate only for the current single-instance instructional deployment. They reset when the server restarts and are not shared across multiple instances.

### Stages 8-2 and 8-3: Transaction Classification

AI classification is connected to confirmation-first transaction forms. A classification response only fills editable form fields; it never writes a `Transaction` directly. Existing registration routes still perform authorization and validation before saving.

Classification supports:

- personal income
- personal expenses
- individual `GROUP_PAYMENT` transactions
- `FUND_INCOME`
- `FUND_EXPENSE`

The following are not AI classification targets:

- `FUND_CONTRIBUTION`
- `FUND_REFUND`
- split-payment participant selection
- calculation method selection
- allocation amounts

Classification requests send only the natural-language input and application-controlled context, such as the Asia/Tokyo reference date and allowed category list. Names, login IDs, group names, database IDs, membership lists, and transaction history are not sent to OpenAI.

Signed suggestion tokens are bound to the user, classification target, and group. They expire after 30 minutes. Invalid or mismatched tokens do not block normal registration; the saved classification source falls back to manual handling and no AI audit data is stored.

### Stage 8-4: Personal Ledger Analysis

A selected personal `LedgerPage` can be analyzed through an explicit AI Analysis action. The server verifies that the page belongs to the authenticated active user, retrieves only the fields required for aggregation, and calculates all totals in TypeScript before calling OpenAI.

The analysis input contains aggregate values only:

- page period and an optional immediately preceding equal-length comparison period
- carryover, income, expense, net change, and closing balance
- income and expense counts
- category totals and shares
- `GROUP_PAYMENT` and `FUND_CONTRIBUTION` totals
- application-calculated warning evidence

Names, login IDs, user IDs, page IDs, transaction IDs, group names, transaction descriptions, and individual transaction rows are not sent to OpenAI.

Analysis output is displayed temporarily in a dialog and is not written to the database, `Transaction.aiResult`, or the session. If AI analysis is disabled, rate-limited, times out, or fails provider/schema processing, the same dialog displays an application-generated automatic summary that is clearly distinguished from AI output.

Application warning evidence is calculated before the AI call. Initial warning conditions include:

- a negative net result for the selected period
- an expense increase of at least 20 percent compared with the previous period
- a single expense category representing at least 50 percent of total expenses

An AI `WARNING` without matching application evidence is downgraded to `NOTICE` before display.

### Stage 8-5: Group Payment Analysis

A selected `GROUP_PAYMENT` `LedgerPage` can be analyzed by active group members. The server verifies the active user, membership, group, and page before calculating aggregates in TypeScript.

The analysis input contains aggregate values only:

- period and an optional immediately preceding equal-length comparison period
- total amount and transaction-row count
- individual payment count
- distinct confirmed payment-batch count
- payment-event count (`individual payments + distinct batches`)
- average transaction amount
- category totals and shares
- application-calculated warning evidence

Names, login IDs, user IDs, group IDs, page IDs, `paymentBatchId` values, transaction descriptions, participant lists, participant shares, and individual member totals are not sent to OpenAI.

Fairness, responsibility, personal relationships, payment ability, and private economic circumstances are explicitly outside the analysis scope.

Provider failure, timeout, limits, configuration failure, or feature disablement produces an application-generated aggregate summary instead of blocking normal use.

### Stage 8-6: Group Fund Analysis

The selected group-fund `LedgerPage` can analyze:

- total fund income and expenses
- internal contributions
- external income
- refunds
- expense categories
- anonymized contribution structure by member

Real names, `userId` values, raw descriptions, and individual transactions are not sent to OpenAI. Each request uses temporary identifiers such as `MEMBER_1`. The server restores display names before rendering the result, and the temporary mapping is not stored in the database, session, or logs.

The interface also shows application-calculated metrics that remain visible even if the AI omits them from its explanation:

- contributor count
- active member count
- internal-contribution dependency ratio
- largest contributor share
- top-three contributor share

The AI is not asked to explain the anonymization mechanism or the temporary member keys.

### Stage 8-7: Total AI Verification

Cross-stage regression and failure-mode verification is implemented without changing the Prisma schema, migrations, or package dependencies.

The suite covers:

- provider 400, 401, 403, 429, temporary 5xx, network failure, timeout, and schema mismatch
- global and feature-specific flags and missing configuration
- per-user and global minute/daily limits
- independent classification and analysis counters and locks
- lock release after success and failure
- restart-equivalent in-memory counter reset
- safe public error messages
- accurate `fallback` logging
- provider token-usage logging
- aggregate-only analysis routes with no database writes
- suggestion-only classification routes
- unchanged Prisma schema and migration hashes
- fixed OpenAI SDK and Zod versions with public npm registry lock URLs

All production classification and analysis calls declare their available fallback. Successful requests log `fallback:false`; failed AI requests replaced by keyword classification or an automatic aggregate summary log `fallback:true`.

## Token and Cost Estimate Helper

Capture server output while performing one classification and the three analysis operations:

```bash
npm start 2>&1 | tee stage8-7-ai.log
```

Then calculate an approximate API cost from the structured `ai_request` log entries:

```bash
node scripts/stage8-7-log-cost.mjs stage8-7-ai.log
```

The estimate is informational. Recheck the current OpenAI pricing page before using it for budgeting.

## Demo Database Reset and Seed

`scripts/reset-demo-data.ts` deletes all current application data from the configured development database and replaces it with a fixed demonstration dataset for review.

Safety conditions:

- execution is rejected when `NODE_ENV=production`
- both `--apply` and `ALLOW_DEMO_DATABASE_RESET=YES_DELETE_ALL_DATA` are required
- deletion and regeneration run inside one Prisma transaction
- any failure rolls back the entire operation
- the Prisma schema, migrations, and database storage format are not changed

Run a dry run first to inspect the target and expected record counts:

```bash
npx prisma generate
npx tsx scripts/reset-demo-data.ts
```

After confirming the target database, explicitly apply the reset:

```bash
ALLOW_DEMO_DATABASE_RESET=YES_DELETE_ALL_DATA \
npx tsx scripts/reset-demo-data.ts --apply
```

Demo credentials:

```text
Login ID: demo_a
Password: Demo2026!
```
