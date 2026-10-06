# Finance System v2

A rebuild of the internal shipping-company finance tool as a proper
multi-user, role-based system: a NestJS API backed by Postgres (Supabase),
and a Next.js frontend with English/Arabic (RTL) support.

- `backend/` — NestJS + Prisma API (auth, users, safes/transfers, clients +
  drawings/deferred ledgers, audit log).
- `frontend/` — Next.js 16 (App Router) + Tailwind + shadcn/ui + next-intl +
  React Query.

## Prerequisites

- Node.js 20+ and npm
- A Postgres database — either a local Postgres instance, or a
  [Supabase](https://supabase.com) project (recommended, see below)

## Backend — local setup

```bash
cd backend
npm install
cp .env.example .env
# edit .env: set DATABASE_URL (and, once wired up, SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / JWT secrets)
npx prisma generate
npx prisma migrate dev --name init   # creates the schema in your database
npm run start:dev                    # http://localhost:4000
```

Other useful scripts:

- `npm run build` — type-checks and compiles to `dist/`
- `npm test` — runs the Jest unit/integration tests (Prisma is mocked; see
  below)
- `npm run prisma:migrate` — shorthand for `prisma migrate dev`

### Backend environment variables (`backend/.env`)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string used by Prisma at runtime. For Supabase, use the pooled ("Transaction mode", port 6543) connection string. |
| `SUPABASE_URL` | Your Supabase project URL (used once real Supabase Auth verification replaces the current login stub — see TODOs in `src/auth/auth.service.ts`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key for server-side admin calls (creating Supabase Auth users from the Users module). Never expose this to the frontend. |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Secrets used to sign the app's own access/refresh JWTs. Generate long random strings; never reuse across environments. |
| `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | Token lifetimes (defaults: `15m` / `7d`). |
| `FRONTEND_ORIGIN` | Origin allowed by CORS (e.g. `http://localhost:3000` or your deployed frontend URL). |
| `PORT` | Port the API listens on (default `4000`). |

### Backend tests

No live Postgres instance is available in the environment this was built in,
so `backend/src/safes/safes.service.spec.ts` and
`backend/src/clients/clients.service.spec.ts` fully mock `PrismaService`
in-memory. They still cover the two invariants called out by the spec:

- a safe-to-safe transfer creates two linked transaction legs and leaves the
  **total balance across both safes unchanged**;
- a partial deferred (آجل) payment reduces `remaining_amount` correctly, and
  a payment that would exceed it is rejected.

Before going to production, add a real integration test suite against a
throwaway Postgres database (e.g. via `docker-compose` or a Supabase branch)
to also exercise actual transaction/rollback behavior, and RLS policies.

## Frontend — local setup

```bash
cd frontend
npm install
cp .env.example .env.local
# edit .env.local: set NEXT_PUBLIC_API_URL to point at the backend
npm run dev      # http://localhost:3000
```

- `npm run build` — production build, fails on any TypeScript error
- `npm run lint` — ESLint

### Frontend environment variables (`frontend/.env.local`)

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | Base URL of the NestJS backend (e.g. `http://localhost:4000`). |

The default locale is `en`; visit `/ar` for the Arabic, RTL-mirrored layout.

## Pointing at a real Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. In **Project Settings → Database**, copy the connection string (use the
   pooled "Transaction" mode string, port 6543, for `DATABASE_URL`; the
   direct port 5432 string is what `prisma migrate` needs when running
   migrations from outside the pooler — Prisma's docs cover using
   `directUrl` for this if you hit connection issues).
3. In **Project Settings → API**, copy the Project URL and the
   `service_role` key into `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.
   Keep the service-role key server-side only (`backend/.env`), never in the
   frontend.
4. Apply the schema to that database:
   ```bash
   cd backend
   npx prisma migrate deploy
   ```
5. Replace the auth stub: `backend/src/auth/auth.service.ts` and
   `backend/src/users/users.service.ts` both have `TODO(supabase-auth)`
   comments marking where real Supabase Auth verification and user
   provisioning need to be wired in.
6. Add Postgres Row Level Security policies mirroring the API-level guards
   (see the plan's security section) as defense-in-depth beneath the NestJS
   RolesGuard.

## Current status / what remains before production

This scaffold gets both `backend` and `frontend` building and passing their
tests end to end, with the full data model, RBAC guard/permission matrix,
audit logging, transactional safe transfers, and client ledgers in place.
Still open, called out via `TODO(supabase-auth)` comments and here for
visibility:

- Real Supabase Auth wiring (password verification, JWT/session
  verification, user provisioning) — today `/auth/login` only checks that an
  active user row exists by email and issues the app's own JWT.
- Postgres RLS policies (schema is ready for them; not yet written since
  there's no live Supabase project in this environment).
- Seed data / fixtures for local development.
- Visual polish pass on shadcn/ui components (this build wires up the design
  tokens and a working layout, not a fully art-directed pass).
- Sentry/pino structured logging and error tracking.
- Load testing of dashboard/transaction-list endpoints under pagination.
- A real Postgres integration test suite (current backend tests mock
  Prisma, see above).
