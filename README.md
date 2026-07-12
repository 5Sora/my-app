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

## Stage 8-2: personal transaction AI classification

Stage 8-2 adds AI-assisted candidate generation for personal income and personal expense transactions.

- Route: `POST /api/ai/classify-transaction`
- The route requires an authenticated active user and does not write a Transaction.
- Only the natural-language transaction text is sent as user input to OpenAI.
- The server adds the Asia/Tokyo reference date, the allowed category list and output rules.
- AI candidates use strict Structured Outputs for transaction type, amount, date, category, summary, field status, missing fields and warnings.
- Missing dates and amounts remain `null` in the AI result. The form may display today's Asia/Tokyo date as a visible default that the user must confirm.
- AI failure, timeout, provider limits, application limits or disabled flags fall back to the existing keyword classifier.
- A signed 30-minute suggestion token binds the candidate to the logged-in user without storing the draft in the database or session.
- The normal `/app/transactions` route performs the final validation and save.
- `classificationSource` is based on the final saved category: unchanged AI category = `AI`, unchanged keyword category = `KEYWORD`, changed or manually selected category = `MANUAL`.
- Successful AI candidates save only minimal audit information in `Transaction.aiResult`. Original natural-language input, prompts, raw provider responses, response IDs and secrets are not saved.
- New personal transactions reject future dates using the Asia/Tokyo application date.

The AI button requires `OPENAI_API_KEY` and `AI_SAFETY_SALT` in `.env`. Without usable AI settings, the form remains usable through keyword fallback and manual entry.

`npm run test:ai` now runs both the Stage 8-1 foundation tests and Stage 8-2 classification tests. The tests use mock provider responses and do not incur OpenAI API charges.
