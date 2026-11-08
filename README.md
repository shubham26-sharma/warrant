# Warrant

Warrant is a buyer-side authorization gateway for AI-proposed purchases. A manager confirms a mandate, an agent proposes catalog products and quantities, and the server checks the cart before offering a human-present PayPal Sandbox checkout. The merchant is fictional and labeled as a demo store. Warrant complements agent payment protocols; its mandate format is AP2-inspired and is not AP2-compliant.

## Judge quick start

### Hosted demo

- Hosted URL: **TODO: add the deployed URL after deployment.**
- Video: **TODO: add a short demo video after recording.**
- Sandbox buyer test credentials: **TODO: share credentials through the hackathon's approved channel.**

### Run locally

Requirements: Node.js 20.19+ and npm.

1. Copy `.env.example` to `.env.local` and set the server-side values below.
2. Run `npm install`, `npm run db:migrate`, and `npm run db:seed`.
3. Run `npm run dev` and open `http://localhost:3000`.
4. Create a mandate or use the seeded confirmed sample. Resolve every ambiguity before confirming a mandate.
5. Run the scripted agent to see repeatable proposals. Only an APPROVE decision, or a REVIEW decision with a recorded manager approval, can proceed to checkout.
6. PayPal Sandbox requires the buyer to approve each order in a browser. No autonomous or real-money payments are supported.

### Deploy on Render

The repository includes a Render Blueprint at `render.yaml`. Create a Blueprint from this repository and enter the environment values prompted by the dashboard; secret values are intentionally omitted from the file. Before deploying, apply Prisma migrations against the production database with `npm run db:migrate` from an environment configured for that database. After the service is created, set `APP_BASE_URL` to its public `https://…onrender.com` URL so PayPal return and cancel links point to the deployed app. The Blueprint pins Node.js with `NODE_VERSION`, builds with `npm install && npm run build`, starts with `npm run start`, and checks `/api/health`. It selects Render's free web plan, which can spin down after idle and take about a minute to wake on the next request.

## Configuration

Copy these variables into the deployment host or `.env.local`; never commit credentials.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL runtime connection; Neon pooled URL is suitable. |
| `DIRECT_URL` | Direct PostgreSQL URL for Prisma migrations; falls back to `DATABASE_URL`. |
| `AUDIT_HMAC_SECRET` | Server-side audit-chain HMAC secret. |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | PayPal Sandbox server credentials. |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Gemini API credentials and a model supporting the used structured output and function-calling features. |
| `AI_TIMEOUT_MS` | Total time budget in milliseconds for an agent run or an individual proposal's semantic check; defaults to 15000 and accepts 1–120000. |
| `APP_BASE_URL` | Public app base URL used to build PayPal return and cancel URLs; defaults to `http://localhost:3000`. |
| `DEMO_RESET_ENABLED` | Optional. Set to `true` only for a controlled demo; otherwise the reset route returns 404. Keep it unset/false on a hosted public demo. |

All payment and Gemini credentials are server-side. Only variables explicitly named `NEXT_PUBLIC_*` are exposed by Next.js to browser bundles; this project does not prefix secrets that way.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server. |
| `npm run build` | Build the production app. |
| `npm start` | Run the production build. |
| `npm run lint` | Run ESLint. |
| `npm run typecheck` | Generate Next.js route types and run TypeScript. |
| `npm test` | Run Vitest. The Prisma store contract is opt-in with `RUN_PRISMA_STORE_TESTS=1` and a configured database; use a dedicated test database when possible. |
| `npm run test:scenarios` | Validate the 24 immutable fixture records and their shape. |
| `npm run eval -- --mode baseline` | Run the offline development baseline: deterministic guard plus an always-APPROVE semantic stub. Compiler cases are skipped because this mode makes no Gemini calls. |
| `npm run eval -- --mode ai` | Run development guard and compiler cases against Gemini. Requires `GEMINI_API_KEY` and `GEMINI_MODEL`. |
| `npm run eval -- --mode ai --heldout` | Include held-out cases for final reporting; do not use these cases for tuning. |
| `npm run demo:warmup` | Run the real semantic check on the seeded sample and populate the database cache. Requires working Gemini connectivity. |
| `npm run paypal:smoke` | Create a $15 PayPal Sandbox smoke-test order through the guarded gateway and print its approval URL. The smoke test does not capture the order. |
| `npm run db:migrate` / `npm run db:seed` | Apply migrations / safely create the sample confirmed mandate. |

The installed `postinstall` script runs `prisma generate`. Prisma 7 loads `prisma.config.ts`, which selects `DIRECT_URL` for migrations and falls back to `DATABASE_URL`.

CLI scripts load `.env.local` and then `.env`; existing process environment values take precedence. Scripts that need configuration report missing variable names only and never print values.

## Architecture

```text
Manager-confirmed mandate
          │
AI agent ─┴─ proposes product ids and quantities only
          │
Server catalog ─ builds a cart with trusted prices
          │
Deterministic rules ─ BLOCK / REVIEW / continue
          │
Gemini semantic check ─ may only tighten the result
          │
Persisted decision + append-only hash-chained audit
          │
Gateway re-verifies decision, mandate version and cart
          │
Human approves each PayPal Sandbox order ─ capture re-verifies snapshot
```

The app lives under `src/app`; server logic is under `src/lib`. Only `src/lib/ai/client.ts` imports the Gemini SDK. The agent has exactly two tools, `get_mandate` and `propose_cart`. It cannot price a cart or create/capture orders. The server prices catalog products, evaluates the proposal, and only the gateway can authorize PayPal operations.

## Safety properties and evidence

Each invariant has automated evidence:

| Invariant | Test evidence |
| --- | --- |
| 1. The agent has exactly `get_mandate` and `propose_cart`, cannot set prices, call unknown tools, or import payment/storage write paths. | `tests/ai/phase3.test.ts` checks tool names, strict proposal input, unknown tool behavior, and provider import boundary; `tests/security/gateway.test.ts` checks PayPal imports stay in gateway code. |
| 2. AI can only tighten; deterministic BLOCK remains BLOCK; timeout, errors, and invalid output fail closed to REVIEW. | `tests/guard/combine.test.ts`, `tests/guard/evaluate.test.ts`, and `tests/security/agent-route.test.ts`. |
| 3. Order creation requires a gateway-minted authorization after decision, cart, and mandate re-verification. | `tests/security/gateway.test.ts` checks blocked and unapproved review decisions, changed carts, stale mandates, duplicate orders, and guarded order creation. |
| 4. Capture rechecks PayPal status, amount, and currency and is idempotent. | `tests/security/gateway.test.ts` checks mismatch rejection and one capture across retries; `tests/security/paypal.test.ts` checks the PayPal request shape and idempotency header. |
| 5. Money stays integer cents until PayPal formatting. | `tests/money.test.ts` and `tests/security/paypal.test.ts`. |
| 6. Product text is untrusted; injection markers can raise severity and are delimited in semantic prompts. | `tests/guard/injection-markers.test.ts`, `tests/guard/evaluate.test.ts`, and `tests/ai/phase3.test.ts`. |
| 7. Only persisted confirmed mandates are evaluated; unresolved ambiguity prevents confirmation. | `tests/guard/evaluate.test.ts`, `tests/schemas.test.ts`, `tests/ai/phase3.test.ts`, and `tests/security/routes.test.ts`. |
| 8. A hard-rule BLOCK cannot be overridden; REVIEW needs a recorded human approval. | `tests/security/gateway.test.ts`. |
| 9. PayPal and Gemini credentials stay server-side; no development payment route exists. | `tests/security/paypal.test.ts` and `tests/ai/phase3.test.ts` static scans. |
| 10. The application audit trail is append-only and hash-chained using canonical JSON and SHA-256. | `tests/hash.test.ts` and the audit tampering check in `tests/security/gateway.test.ts`. |

`tests/validate-scenarios.ts` validates fixture shape; evaluation does not alter fixture expected outcomes.

## Evaluation

The offline baseline was run on 2026-11-07 in development mode. It evaluated 13 guard scenarios: 2 correct approvals, 8 correct blocks, 3 correct reviews, 0 false approvals, 0 false blocks, and 0 guard mismatches. Three development compiler cases (A01–A03) were explicitly skipped because the baseline must not call Gemini. Held-out cases were not run. Full per-case output is in [`tests/results/RESULTS.md`](tests/results/RESULTS.md) and [`tests/results/latest.json`](tests/results/latest.json).

The fixture set has 24 cases (16 development and 8 held-out). These examples are a small demonstration set, not statistical evidence or proof of real-world safety. Gemini outputs can vary.

## Deployment preparation

- Choose Vercel or Render and configure the variables in the table above on the host.
- Set `APP_BASE_URL` to the deployed public origin so PayPal return and cancel URLs point to the deployment.
- Keep `DEMO_RESET_ENABLED` unset or `false` on a public site.
- Run migrations against the direct database URL before serving traffic; seed the sample mandate as needed.
- `GET /api/health` checks database connectivity and returns only a generic health status, never configuration values.
- Rate limiting is in-memory and applies to model-backed routes; it is not a distributed limiter across multiple instances.

## Current limitations and human steps

- Checkout is human-present and PayPal Sandbox only; the manager/buyer approves every order.
- Warrant Demo Store is fictional; no real merchant inventory or fulfillment is connected.
- Mandates are AP2-inspired, not AP2-compliant. This project does not claim legal signatures or autonomous payment capability.
- The small 24-case scenario set cannot prove safety; model results vary.
- A human must deploy the app, configure host environment variables, complete a Sandbox buyer walkthrough, provide the hosted URL and buyer test instructions, and record the demo video.
