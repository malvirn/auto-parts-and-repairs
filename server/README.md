# Centric API foundation

This is the first backend increment for Centric Auto Mobile. It runs beside the existing static HTML/JavaScript frontend. It does not replace frontend modules, change database tables, or move existing business workflows.

## Stack

- Node.js 22.12 or newer for local/server hosting
- NestJS 12
- TypeScript
- Existing Supabase Auth and PostgreSQL
- Cloudflare Workers runtime for the edge deployment

## Current endpoints

- `GET /api/v1/health/live` - process liveness
- `GET /api/v1/health/ready` - configuration readiness
- `GET /api/v1/me` - authenticated user ID and role

All routes are protected by default. Only endpoints explicitly marked public bypass the authentication guard.

## Authentication and permissions

1. The API requires a Supabase access token in `Authorization: Bearer <token>`.
2. It asks Supabase Auth to verify the token using `/auth/v1/user`.
3. It reads only `id, role, is_active` from `public.profiles`, using that same user's access token and the project's publishable key.
4. It rejects missing profiles, inactive accounts, and unrecognised roles.
5. Role checks use the database profile role, not user-editable JWT metadata.

The API does not use a service-role or secret key. User-scoped profile reads remain subject to the existing RLS policies. The role allow-list matches Centric's four application roles: `super_admin`, `workshop`, `staff`, and `accounting`.

## Local Node.js setup

From this directory:

```bash
cp .env.example .env
# Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env
npm install
npm run build
npm test
npm run start:dev
```

Configure `CORS_ORIGINS` with the exact HTTPS origin of the deployed frontend before browser integration. CORS is disabled by default until an origin is configured.

## Cloudflare Workers

The Worker entry point is `src/worker.ts`; the traditional Node.js entry point remains `src/main.ts`. Both use the same Nest module, authentication guards, controllers, and HTTP configuration.

Set the Supabase publishable key as a Worker secret. Do not commit it:

```bash
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
```

The Supabase URL and current Cloudflare Pages frontend origin are non-secret Worker variables in `wrangler.jsonc`. Update `CORS_ORIGINS` only when the production frontend origin changes.

Build checks:

```bash
npm run build
npm test
npm run build:worker
```

Local Worker development requires a local secret file or configured local variables:

```bash
npx wrangler dev --local
```

Deploy only after the Worker bundle build and runtime smoke tests pass:

```bash
npm run deploy:worker
```

NestJS on Workers is not an officially supported Nest deployment target. This Worker uses Cloudflare's Node.js HTTP server bridge. WebSocket gateways, TCP microservice transports, shutdown hooks, and other unsupported Node server features must not be added to this Worker without a separate compatibility review. The optional class-validation, microservices, and websocket modules are aliased to a no-op only because the current API does not use them. If the API later adds those features, remove the alias and implement/test the required package explicitly.

## Migration rules

- Existing frontend-to-Supabase flows remain unchanged in this increment.
- Do not route payments, receipts, credit notes, stock movements, or ledger writes through this API until each workflow has been mapped and tested.
- Do not expose privileged database keys.
- Keep RLS enabled. The API must not bypass it as a shortcut.
- Add each migrated business operation with server-side authorization, database transactions, idempotency, audit logging, and automated tests.
- Test write workflows only against an isolated test project. Do not insert test data into the live Centric database.

## Known next steps

- Commit and use a reproducible API lockfile.
- Confirm the Worker bundle builds and starts in the Workers runtime.
- Set the publishable key as a Cloudflare Worker secret.
- Deploy the Worker and verify its health endpoints.
- Confirm the frontend can call the API with the configured CORS origin.
- Review the complete profile/RLS policy set and test role access with dedicated test accounts.
- Map existing RPCs and Edge Functions before choosing the first workflow to migrate.
- Add request IDs, rate limiting, and production monitoring before exposing business routes.
