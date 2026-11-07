# Warrant

Warrant is a buyer-side authorization gateway for AI-proposed purchases. The agent can propose a cart; Warrant checks it against a human-confirmed mandate before an order can be created. This project targets PayPal Sandbox and human-present checkout.

## Development

Use Node.js and npm. Install dependencies with `npm install`, then start the app with `npm run dev`.

The Next.js App Router is in `src/app`, with application libraries under `src/lib`.

Copy `.env.example` to `.env.local` and fill credentials only when the relevant phase needs them. Never commit `.env.local`.

## Phase 1 commands

- `npm run lint` checks formatting and lint rules.
- `npm run typecheck` generates Next.js route types, then runs TypeScript without emitting files.
- `npm test` runs unit tests.
- `npm run test:scenarios` validates the provided 24 scenario fixtures.
- `npm run eval`, `npm run db:migrate`, `npm run db:seed`, and `npm run paypal:smoke` are placeholders until their implementation phases.

The Prisma schema is defined in `prisma/schema.prisma`. No database migration is run in Phase 1.

## Current implementation status

The library layer now includes the fictional Warrant Demo Store catalog, server-priced cart construction, prompt-injection markers, deterministic mandate checks, and verdict combination. The Phase 2 guard has no network or model calls; callers inject a semantic-check function, and the deterministic rules remain the decision floor. The AI-backed agent, application checkout flow, and PayPal gateway are not implemented yet.
