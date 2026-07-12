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
