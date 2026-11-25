# Centric API foundation

This is the first backend increment for Centric Auto Mobile. It runs beside the existing static HTML/JavaScript frontend. It does not replace frontend modules, change database tables, or move existing business workflows.

## Stack

- Node.js 22.12 or newer
- NestJS 12
- TypeScript
- Existing Supabase Auth and PostgreSQL

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

## Local setup

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

## Deployment

The API is host-independent. Configure the hosting service to use this directory as its root, install dependencies, run `npm run build`, and start with `npm start`. Set the environment variables in the hosting dashboard, not in Git.

## Migration rules

- Existing frontend-to-Supabase flows remain unchanged in this increment.
- Do not route payments, receipts, credit notes, stock movements, or ledger writes through this API until each workflow has been mapped and tested.
- Do not expose privileged database keys.
- Keep RLS enabled. The API must not bypass it as a shortcut.
- Add each migrated business operation with server-side authorization, database transactions, idempotency, audit logging, and automated tests.
- Test write workflows only against an isolated test project. Do not insert test data into the live Centric database.

## Known next steps

- Generate and commit the npm lockfile after dependency installation in a controlled environment.
- Run the backend build and tests in GitHub Actions.
- Confirm the frontend production origin and configure CORS.
- Review the complete profile/RLS policy set and test role access with dedicated test accounts.
- Map existing RPCs and Edge Functions before choosing the first workflow to migrate.
- Add request IDs, structured logs, rate limiting, and production monitoring before exposing business routes.
