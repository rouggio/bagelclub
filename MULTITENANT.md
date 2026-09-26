# Multitenant — many clubs, no crosstalk (deferred)

> Analysis only (2026-09-26). No code changed. Revisit when a second club is needed.

## Recommendation
Shared DB + `club_id` discriminator on every tenant table. Schema-per-tenant or
DB-per-tenant would explode ops (migrations × N, connection fan-out, per-club env)
for no current benefit. Estimate: 2–4 focused sessions, mostly mechanical.

## Why it cuts deep
The app is single-club down to the schema: `app_settings` is a one-row table
(`id = 1`), JWT is `{id, username, role}` with no club scope, timezone is a global
env (`CLUB_TIMEZONE`), and there is one Telegram bot / one WhatsApp sender.

## Impact by layer

### 1. Schema (biggest)
- New `clubs` table (`id, slug unique, name, timezone, created_at`).
- `club_id` FK → `users, courts, bookings, blocks, blockingRules, auditLog`
  (timetables inherit scope via courts, as today).
- `app_settings.id = 1` dies → `app_settings.club_id PK` (timetable defaults,
  auto-approve, notification creds — all per club).
- Timezone moves per club (booking guards, reports, frontend all read the env today).
- Uniqueness becomes composite: `users(username/email)` per club,
  `courts.number` per club. Overlap logic is already per-court, so it inherits
  scoping for free.
- Migration: backfill one `club_alpha` row, stamp existing rows, then
  `SET NOT NULL`.
- Open decision: one user = one club (`club_id` on users — simple, recommended
  for v1) vs. memberships join table (one login, many clubs — ~2× auth cost).

### 2. Auth (hardest)
- JWT becomes `{id, clubId, role…}`; `authenticate` rejects cross-club access.
- Login resolves club first (slug/subdomain before credential check — the same
  username may exist in two clubs).
- New `superadmin` platform role to bootstrap club #2 (outside club scoping).
- Refresh-cookie flow survives mostly as-is under single-club users.

### 3. Backend routes (mechanical but total — ~13 files)
Scope `where club_id = X` in: bookings, courts, timetable, blocks/rules,
availability (public — must take club slug), users, reports, settings,
club-info, telegram link/status.
- `telegram/webhook` must map bot-token → club (each club brings its own bot).
- `notifyAdminPendingBooking`'s linked-admin union must also filter `club_id`.

### 4. Frontend (medium)
- Club context via path (`/c/:slug/…`) or subdomain; `X-Club-Slug` header is the
  least invasive way to attach it to the existing `fetch("/api/…")` calls.
- Per-club footer/branding (`BRAND_NAME`/`clubInfo` stop being global),
  per-club availability pages and notification deep links.

### 5. Ops (small)
Same Render service + Neon DB. Env keeps platform secrets only; per-club creds
live in `app_settings`. Seed becomes "seed club".

## Crosstalk hotspots (test explicitly)
Public availability/timetable reads, Telegram webhook routing, the admin-union
notify query, reports aggregation, username/email login scoping.

## Phases
1. Schema + backfill migration, `clubs` table, per-club settings/timezone.
2. Auth: club-scoped login/JWT/roles + superadmin.
3. Route-by-route scoping + Telegram routing.
4. Hardening: Postgres RLS (`current_setting('app.club_id')`) + per-endpoint
   cross-club tests.
5. Frontend club context + per-club branding/links.
