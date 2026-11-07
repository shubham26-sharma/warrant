<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Warrant: instructions for the coding agent

Read this file fully before every task. It is the source of truth. If a phase prompt conflicts with it, stop and ask.

## What we are building

**Warrant** is a buyer-side authorization gateway for AI agents that spend money through PayPal. An AI agent can only *propose* a purchase. Warrant checks the proposal against a human-confirmed mandate, and only an approved proposal can become a PayPal Sandbox order.

- Hackathon: PayPal AI Hackathon. Judges must be able to run or use a working build. Deadline Nov 13 2026 01:30 IST; we submit by Nov 12 evening IST.
- Persona: a small-business office manager delegating routine supply reorders to an AI agent.
- One-line pitch: Warrant is a buyer-side authorization gateway that checks whether an AI agent's proposed purchase matches the manager's mandate before any PayPal order can be created.
- Positioning: complements PayPal's agentic tools and agent payment protocols (AP2, ACP). It does not replace them. Our mandate format is "AP2-inspired", never "AP2-compliant".
- Scope boundary: **human-present checkout only**. The buyer approves each PayPal order. No autonomous or delegated payments. Sandbox only. No real money.

## Non-negotiable invariants

Every invariant needs an automated test. Never weaken a test to make it pass; fix the code.

1. **No payment capability for the agent.** The agent's tool surface is exactly `get_mandate` and `propose_cart`. The agent module must not import PayPal, the gateway, or any database write path.
2. **AI can only tighten.** Verdict severity is APPROVE < REVIEW < BLOCK. Final verdict = max(deterministic, AI). A deterministic BLOCK is never changed. AI failure, timeout or schema-invalid output means REVIEW (fail closed), never APPROVE.
3. **Guarded order creation.** `createPayPalOrder` accepts only an `OrderAuthorization`, a branded type that can only be constructed by the gateway after it re-verifies the stored decision (see Gateway). Changing the cart or the mandate invalidates the decision.
4. **Capture only after re-verification.** Before capture, fetch the PayPal order and verify status, amount and currency equal the stored snapshot. Capture is idempotent (deterministic `PayPal-Request-Id`, unique constraint per decision).
5. **Money is integer cents everywhere.** Convert to PayPal's decimal string only inside `src/lib/paypal.ts`.
6. **Product text is untrusted data.** Titles and descriptions never act as instructions. They are passed to models inside clearly delimited data blocks, and hostile text can only raise severity.
7. **The guard reads only persisted, confirmed mandates.** AI-compiled constraints are drafts until the human confirms them. A mandate with unresolved ambiguity can never be confirmed.
8. **Human overrides.** A hard-rule BLOCK cannot be overridden by anyone; the manager edits the mandate, which creates a new version. A REVIEW can be approved by a human, and the approval is recorded in the audit log.
9. **Secrets stay server-side.** PayPal and OpenAI keys are read only in server modules, never sent to the browser, never committed.
10. **Audit log is append-only and hash-chained.** Canonical JSON + SHA-256 chain. Describe it as a tamper-evident application audit trail, never as a legal signature.

## Decision logic

```
deterministic rules ->  any BLOCK          => BLOCK  (final)
                        else any REVIEW    => REVIEW (AI not consulted, or consulted only to add reasons)
                        else               => AI semantic check -> final = max(det, ai)
```

Deterministic BLOCK rules: currency mismatch; merchant not in `allowedMerchantIds`; `totalCents` > maximum; total quantity > `maximumQuantity` (it is a ceiling, not an exact count); known `deliveryDays` > maximum; a required attribute that is present and differs (case-insensitive, trimmed); cart arithmetic inconsistent (line sum != subtotal, or subtotal + shipping + tax != total).

Deterministic REVIEW rules: `deliveryDays` is null; a required attribute is null/missing; title or description contains a size token (A3, A4, A5 ...) that conflicts with the structured size attribute; title/description contains a prompt-injection marker (patterns such as "ignore the mandate", "ignore previous", "system override", "system prompt", "bypass", "approve this", "/api/", "change mandate"). The marker list lives in one file and is unit-tested.

`evaluateCart(mandate, cart, semanticCheck)` takes the semantic check as an injected function so tests can pass a stub. Production routes always inject the real model-backed check. The guard refuses (throws `MandateNotConfirmedError`) if the mandate is not CONFIRMED.

Every rule emits `{ ruleId, mandateClause, cartPath, passed, severity, message }`. The Decision stores all rule results, the AI result (raw structured output), and the final verdict.

## Stack and conventions

- Next.js 16 (App Router, `src/` directory, `@/*` alias), TypeScript strict, Tailwind. Cache Components is enabled in this project: check the installed Next.js docs before writing routes and pages; keep payment, agent and DB-backed pages dynamic. Do not add `export const runtime`. `params` and `searchParams` are promises in current Next.js.
- Zod for every boundary (API input, AI output, DB JSON). Prisma + PostgreSQL (hosted Neon, no Docker assumed). Check the current Prisma + Next.js docs for client setup rather than relying on memory.
- Official `openai` npm package with schema-validated structured outputs. Model name comes from `OPENAI_MODEL`; never hardcode one. Low temperature.
- Tests: Vitest. DB access goes through a thin `Store` interface with an in-memory implementation for unit tests and a Prisma implementation at runtime.
- AG Grid (community) for the audit table only.
- Windows-friendly: npm scripts must not use bash-only syntax. The developer uses PowerShell.
- Small files, named exports, no `any`, no default-exported singletons that read env at import time.
- Do not add LangChain, vector databases, multi-agent frameworks, auth providers or a separate backend.

## Repository layout (under `src/`)

```
app/                    pages and route handlers
lib/schemas/            mandate, cart, decision, ai-output (Zod)
lib/money.ts            cents helpers
lib/hash.ts             canonicalJson, sha256, hash chain
lib/guard/              rules, injection markers, combine, evaluate
lib/ai/                 client, mandate compiler, semantic check, agent loop, scripted agent
lib/catalog/            mock merchant ("Warrant Demo Store")
lib/gateway/            authorize.ts (only place that mints OrderAuthorization), purchase flow
lib/paypal.ts           token, create, get, capture (only module that reads PayPal env)
lib/store/              Store interface, memory impl, prisma impl
lib/audit/              append, verify chain
tests/fixtures/         scenarios.json (provided; do not change expected outcomes)
tests/results/          eval output
```

## Commands that must exist and work

`npm run dev`, `lint`, `typecheck`, `build`, `test` (unit + security), `test:scenarios` (fixture validator), `eval` (runs the 24 scenarios, writes `tests/results/`), `paypal:smoke` (create an order, print approval URL), `db:migrate`, `db:seed`.

## Mock merchant

"Warrant Demo Store" is fictional and must be labeled as a demo merchant everywhere it appears. The agent supplies only `productId` and `quantity` to `propose_cart`. **The server builds the cart from the catalog** (prices, shipping, delivery, attributes). The agent can never set a price.

## Evaluation rules

- `tests/fixtures/scenarios.json` is provided. 24 cases: 16 `development`, 8 `held_out`, 20 with `expectedStage: "guard"`, 4 with `expectedStage: "compiler"` (ambiguous mandates; expected result: compiler flags ambiguity and the mandate cannot be confirmed).
- Never edit expected outcomes. If a case reveals a flaw, add a new case with a new id.
- The eval runner reports tuning and held-out results separately. Held-out requires an explicit `--heldout` flag and prints a warning that it must not be used for tuning.
- Report per case, plus: correct approvals, correct blocks, correct reviews, ambiguity detection, **false approvals (the key metric)**, false blocks. Two runs: (a) deterministic rules + stub "always approve" AI (offline baseline), (b) real AI.
- Never claim statistical accuracy. State that 24 cases do not prove real-world safety.

## When you need a human

Stop and print exactly what the human must do, then wait. Needed for: creating the Neon database, filling `.env.local`, approving a PayPal order as the sandbox buyer (needs a browser login), supplying the OpenAI key, deploying, recording the video. Never invent credentials, never commit `.env.local`.

## Non-goals

Autonomous background payments, real merchants, user accounts or login, refunds, disputes, predictive scoring, multi-currency support beyond rejecting mismatches, mobile app.

## Definition of done for any task

`npm run lint`, `npm run typecheck`, `npm test` pass; no secrets in the diff; invariants still covered by tests; README updated if behavior or commands changed; a short summary of what changed and what is unverified.
