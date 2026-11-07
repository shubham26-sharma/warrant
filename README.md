# Warrant

Warrant is a buyer-side authorization gateway for AI-proposed purchases. A manager confirms a purchase mandate, an agent proposes a cart from a server-priced catalog, and Warrant evaluates it before a human can continue to PayPal Sandbox. The merchant is fictional and all checkout stays sandbox-only.

## Run locally

Requirements: Node.js 20.19+ and npm.

1. Copy `.env.example` to `.env.local` and set the database and PayPal Sandbox credentials. Set `GEMINI_API_KEY` and `GEMINI_MODEL` only if you want to run the live model; choose a model that supports structured output and function calling.
2. For Neon, use the pooled connection in `DATABASE_URL` for runtime and the direct connection in `DIRECT_URL` for Prisma migrations. Both remain server-side.
3. Run `npm install`, `npm run db:migrate`, `npm run db:seed`, then `npm run dev`.
4. Open `http://localhost:3000`. Use the seeded sample mandate or create and confirm another one. The scripted agent gives repeatable proposals; the live agent uses Gemini.
5. `npm run demo:warmup` uses the scripted compliant proposal and the live semantic checker to populate the persistent cache. It needs a working Gemini key/model.

If the AI is unavailable, the guard fails closed to REVIEW with the reason “AI check unavailable”; the page remains usable. PayPal Sandbox still requires the buyer to approve each order in a browser.

## Available commands

- `npm run dev`, `npm run build`, `npm start`
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:scenarios`
- `npm run db:migrate`, `npm run db:seed`, `npm run demo:warmup`
- `npm run paypal:smoke` creates a $10 Sandbox order using a test-only authorization helper in the script; it prints the approval URL.
- `npm run eval` is not implemented yet.

The Prisma CLI reads `.env.local`; migrations prefer `DIRECT_URL` and fall back to `DATABASE_URL`. Generated Prisma client files live under `src/generated/prisma` and are ignored by Git.

## Architecture

```text
Human-confirmed mandate
          │
AI agent ─┴─ proposes product ids and quantities only
          │
Server catalog ─ builds a cart with trusted prices
          │
Deterministic checks ─ BLOCK / REVIEW / continue
          │
Gemini semantic check ─ may only tighten the verdict
          │
Persisted decision + append-only hash-chained audit
          │
Gateway re-verifies decision, cart and latest mandate version
          │
Human approves order in PayPal Sandbox ─ capture re-verifies snapshot
```

Only `src/lib/ai/client.ts` imports the Gemini SDK. The agent has exactly two tools: `get_mandate` and `propose_cart`. The latter accepts product ids and quantities; prices and merchant data come from the server catalog. Semantic results are stored by prompt version, model, mandate hash, and cart hash after Zod validation.

## Safety boundaries

- Money stays in integer cents until `src/lib/paypal.ts` formats a PayPal decimal amount.
- A deterministic BLOCK cannot be overridden. A REVIEW needs a manager note before checkout. AI failure or invalid output means REVIEW.
- The agent cannot import PayPal, the gateway, storage, or Prisma and cannot create or capture orders.
- Checkout creation requires a gateway-minted authorization that rechecks the stored decision, cart hash, confirmed mandate hash, latest mandate version, and prior order state.
- Capture fetches PayPal’s order and verifies status, amount, and currency against the saved snapshot. Requests use deterministic idempotency ids.
- Product titles and descriptions are untrusted data. No background or autonomous payments are supported.
- The audit trail is tamper-evident application data, not a legal signature.
- The 24 scenario fixtures are a small demonstration set, not proof of real-world safety. Model output can vary. The mandate format is AP2-inspired and is not AP2-compliant.

## Demo data and privacy

The sample mandate authorizes up to five packs of A4 recycled paper for at most $60 total and three delivery days from the labeled Warrant Demo Store demo merchant. Product data in this repository is fictional. Never commit `.env.local`; Gemini and PayPal credentials are server-side only.

`POST /api/demo/reset` is disabled unless `DEMO_RESET_ENABLED=true`. Enabling it clears demo records and restores the sample mandate.

## Human walkthrough still required

- Configure a reachable PostgreSQL database and run the migrations/seed.
- Configure valid Gemini credentials/model to use live AI and run warmup.
- Use the PayPal Sandbox buyer account to approve a Sandbox order and confirm the capture in the Sandbox business account.
- Deploy, record a demo video, and add screenshots before submission.
