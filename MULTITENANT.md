# Multitenant — many clubs, no crosstalk

> Analysis only (2026-09-26, extended 2026-09-27 on `feat/multitenancy`). No code changed.
> Locked for v1: one user = one club (`club_id` on users, no memberships join table).
> Feature list lives in `FEATURES.md` — this file is the design doc for features 5–15.

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
- Uniqueness becomes composite + active-only: `users(username/email)` per
  `(club_id)` — the same handle may live in many clubs (`MULTITENANT.md` §2
  login resolves club first).
- User deletion becomes logical (locked 2026-09-27): `users.deleted_at
  TIMESTAMPTZ NULL` + `deleted_by UUID NULL`. `DELETE /api/users/:id` sets both
  instead of deleting — today `users.ts:156-187` physically deletes and
  **cascade-destroys the user's bookings**; soft delete preserves booking
  history (rows keep `user_id`, username map shows the handle, login rejected).
  - Reuse of handle/email after delete via **partial unique indexes** (option a,
    option b suffix-rename rejected — it destroys the audit handle):
    `CREATE UNIQUE INDEX users_club_username_active ON users(club_id, username)
    WHERE deleted_at IS NULL` and `..._email_active ON users(club_id, email)
    WHERE deleted_at IS NULL AND email IS NOT NULL`. Plain `UNIQUE(username /
    email)` constraints are dropped. Drizzle can't express partial uniques →
    raw SQL in the migration.
  - Every read defaults to live rows: logindup-checks, `GET /api/users`,
    last-admin guard (counts non-deleted admins), `GET /me` on deleted →
    `401` + client drops token. Admin audit view via `?include_deleted=true`;
    restore `POST /api/users/:id/restore` → `409` if the handle/email was
    re-taken by a live row.
- `courts.number` unique per `(club_id, number)`. Overlap logic is already
  per-court, so it inherits scoping for free.
- Migration: backfill one `club_alpha` row, stamp existing rows, then
  `SET NOT NULL`.
- Locked v1: one user = one club (`club_id` on users). Memberships join table
  (one login, many clubs) deferred — ~2× auth cost, revisit only on demand.
- Settings split (audited 2026-09-27, all 22 `app_settings` cols + all env):
  - `app_settings` → **all per-club, nothing stays global.** Booking policy
    (`default_slot_duration_minutes, booking_hold_minutes, max_advance_days,
    min_cancel_hours, auto_approve_bookings`), identity (`club_name/phone/
    address/public_url`), notify flags (`notifications_enabled,
    notify_on_auto_approved/approval/rejection, notify_via_telegram/whatsapp`),
    creds (`telegram_bot_token/admin_chat_id, whatsapp_token/phone_number_id/
    admin_phone`). Table key becomes `club_id PK` replacing `id = 1`.
  - Env **stays global**: `DATABASE_URL, PORT/HOST, NODE_ENV, LOG_LEVEL,
    CORS_ORIGIN` (infra); `JWT_SECRET, JWT_EXPIRES_IN, JWT_REFRESH_EXPIRES_IN`
    (one signer platform-wide, club scope inside JWT); `BRAND_NAME,
    VITE_BRAND_NAME` (platform landing brand only).
  - Env **changes meaning**: `CLUB_TIMEZONE` dies entirely — `clubs.timezone`
    is `NOT NULL` with **no default** (locked 2026-09-27). Club creation
    (`POST /api/platform/clubs`) must carry a valid IANA timezone, rejected
    otherwise. Every time path (booking guards, reports, timetable, blocks,
    announcements) resolves tz from the owning club row — never env, never
    hardcoded fallback. Platform has no global timezone either; superadmin UI
    renders each club's times in that club's tz with tz label shown.
  - Notify technical params are **strictly club-specific** (locked 2026-09-27):
    `telegram_bot_token/admin_chat_id, whatsapp_token/phone_number_id/admin_phone`
    plus notify flags and `public_url` live only in per-club settings. The env
    fallbacks (`TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_ID,
    WHATSAPP_TOKEN/PHONE_NUMBER_ID/ADMIN_PHONE, FRONTEND_URL/PUBLIC_URL` in
    `notifications.ts:76,234-238`, `telegram.ts:25`) are **removed**, not kept
    as last resort — any shared fallback is a crosstalk gun.
  - New global: `SUPERADMIN_EMAIL/PASSWORD` (superadmin bootstrap).
  - Hardcoded single-club defaults to replace: `"Green Village",
    "3923047417", empanadel.onrender.com` (`settings.ts:11-45`, `brand.ts`,
    `notifications.ts:76`).

### 2. Auth (hardest)
- JWT becomes `{id, clubId, role…}`; `authenticate` rejects cross-club access.
- Login resolves club first (slug/subdomain before credential check — the same
  username may exist in two clubs).
- New `superadmin` platform role to bootstrap club #2 (outside club scoping).
- Refresh-cookie flow survives mostly as-is under single-club users.
- Club admins are never self-registered (locked 2026-09-27): public register
  forces `associate`. A club `admin` comes into existence only two ways —
  (a) designated at club creation (`POST /api/platform/clubs` carries the
  initial admin email, provisioned with the seed), or (b) created/promoted
  later by the platform admin (or by an existing club admin promoting a club
  user). Role escalation paths (`PATCH /api/users/:id/role`,
  `PATCH /api/users/:id/language`) stay club-scoped and admin-only.

### 3. Backend routes (mechanical but total — ~13 files)
Scope `where club_id = X` in: bookings, courts, timetable, blocks/rules,
availability (public — must take club slug), users, reports, settings,
club-info, telegram link/status.
- `telegram/webhook` must map bot-token → club (each club brings its own bot).
- `notifyAdminPendingBooking`'s linked-admin union must also filter `club_id`.

### 4. Frontend (medium)
- Club context via path (`/club/:slug/…`) or subdomain; `X-Club-Slug` header is the
  least invasive way to attach it to the existing `fetch("/api/…")` calls.
- Per-club footer/branding (`BRAND_NAME`/`clubInfo` stop being global),
  per-club availability pages and notification deep links.

### 6. Club slug — URI-compatible club name + deep link
- `clubs.slug`: URI-safe, lowercase `^[a-z0-9-]{3,50}$`, `UNIQUE NOT NULL`,
  immutable after creation (rename = new slug + redirect row, deferred).
  Generated from club name (`Green Village` → `green-village`, dedupe with
  `-2` suffix). Reserved list: `api, health, assets, c, clubs, admin, login,
  register, me, profile`.
- Canonical deep link: `/club/:slug/` serving the same `index.html` (current SPA
  fallback in `backend/src/app.ts:90-98` already returns `index.html` for any
  non-`/api|/health|/assets` path, so no backend change needed for serving).
  Hash views preserved underneath: `/club/:slug/#courts`,
  `/club/:slug/#admin-bookings?highlight=<id>`.
- Resolution order per request: `X-Club-Slug` header (set by frontend from
  path) → `?slug=` query (public GETs: `club-info`, `availability`,
  `announcements`) → JWT `clubId` (authed writes, must match header).
  Mismatch → `400/403`.
- Public reads take slug, never JWT: `GET /api/club-info?slug=`,
  `GET /api/availability?slug=&court_id=&date=`, `GET /api/announcements?slug=`.
- Notification deep links become per-club:
  `{club.publicUrl}/club/:slug/#admin-bookings?highlight=<id>`
  (`services/notifications.ts:75-78` today builds a global URL).
- Telegram link token encodes club: `t.me/<bot>?start=<token>` resolves to
  `(club_id, user_id)`; each club brings its own bot (`botToken → club` map
  on webhook).
- `localStorage` namespaced by slug (`token_<slug>`, `pending_booking_intent_<slug>`)
  so two clubs don't share session/intent in one browser.

### 7. Platform frontend — promote the app + club directory
- Root `/` stops being one club's landing and becomes the **platform site**:
  hero (what BagelClub is), features, pricing/CTA (`Add your club`), club
  directory (`/clubs` → cards from `GET /api/clubs` public: `slug, name,
  publicUrl?, courts count?`), footer platform-wide.
- Club app lives exclusively under `/club/:slug/` (courts, confirm, login,
  register, me, profile, admin-*). Bare `/courts`, `/#me` etc. redirect to
  directory or to default club only during migration (then removed).
- New/changed views: `platform-home` (`/`), `club-directory` (`/clubs`,
  search by name), existing club views reused under prefix. `document.title`,
  header logo, footer switch: platform brand on `/`, per-club `clubInfo`
  (name/phone/address/logo) under `/club/:slug/`.
- New public endpoint: `GET /api/clubs` → `[{slug, name}]` (+ optional
  `public_url`, `courts` count) for directory; `superadmin` CRUD
  `POST/PATCH /api/clubs` (create club + seed settings + slug validation).
- SEO: `/` + `/clubs` indexable, per-club pages indexable by slug;
  per-club `public_url` remains the shareable canonical for notifications.

### 8. Pricing — MVP scope (display first, collection deferred)
Wider feature list addition (2026-09-27). Online payment collection stays
deferred per `SPEC.md:20` (non-goal); **pricing display + totals are MVP**.

A. Platform pricing (club pays BagelClub):
- `clubs.plan` (`free|starter|pro`, default `starter`), `trial_ends_at`,
  `is_active`, `max_courts` (plan enforcement deferred to validation).
- Platform landing `/` shows pricing tiers (static content first, no checkout);
  `superadmin` assigns plan per club (`PATCH /api/clubs/:slug`).
- Billing integration (Stripe/subscriptions/invoices) explicitly **not MVP** —
  manual invoicing until demand.

B. Court rental pricing (player pays club, pay-on-site):
- MVP minimal model: `courts.base_price_cents INT NOT NULL DEFAULT 0` +
  `clubs.currency CHAR(3) DEFAULT 'EUR'`; price shown per slot in availability,
  confirm screen, my-bookings + admin queue.
- `bookings.price_cents` snapshot at creation (price may change later; reports
  use snapshot, not live join).
- Deferred (not MVP): peak/off-peak rules table (`court_id, day_of_week,
  start/end, price_cents`), duration scaling, discounts/memberships, online
  pay/wallet. Schema must leave room: price lives on court + snapshot on
  booking, so a rules table can be added without breaking MVP data.
- Reports: revenue total per period from `bookings.price_cents`
  (`status=approved` only).

### 9. Platform admin — above all clubs
Role name (locked): `superadmin`. One role added to `user_role` enum; sits
outside club scoping (`club_id NULL`, JWT `{id, role: superadmin, clubId: null}`).

- Bootstrap: seeded from env (`SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`
  hashed) via `npm run seed:platform`; public `POST /api/auth/register` can
  never create it (forces `associate` + `club_id`).
- Auth: same login endpoint, no slug required; `authenticate` accepts
  `clubId: null` only with `role=superadmin`; new `requireSuperadmin`
  middleware gates `/api/platform/*`; refresh-cookie flow unchanged.
  Every platform action writes `audit_log` (`actor_id`, `action=platform.*`).
- Capabilities (MVP):
  - Clubs: `GET /api/platform/clubs` (all: `slug, name, plan, is_active,
    courts/users/bookings counts`), `POST /api/platform/clubs`
    (`name → slug`, `timezone`, seed `app_settings` + optional demo courts +
    initial club `admin` user), `PATCH /api/platform/clubs/:slug`
    (`plan, is_active/suspend, timezone, public_url`), `POST
    /api/platform/clubs/:slug/seed` (re-seed defaults, no wipe).
  - Users: cross-club read-only lookup (support), reset club-admin password,
    disable user; no silent impersonation in MVP (deferred, needs audit +
    banner).
  - Platform content: pricing tiers copy on `/`, directory visibility toggle
    per club (`clubs.is_listed`), platform-wide announcements (deferred —
    per-club `announcements` only in MVP).
  - Ops read: health + per-club counts; plan enforcement (`max_courts`,
    `is_active` block login with `403 club suspended`) — soft enforcement only.
- Frontend: `/platform` area (separate from club `admin-*` views):
  `platform-login`, `platform-clubs` (table + suspend/activate + plan select),
  `platform-club-new` (wizard: name → slug preview + reserved check, timezone,
  admin email), `platform-audit` (read-only log). Never mounted under
  `/club/:slug/`; platform brand, no club context, no `X-Club-Slug`.
- Security: rate-limit login 5/min/IP (existing), strong seed password required
  (`≥16` chars or generated), 2FA deferred; `GET /api/clubs` public directory
  only exposes `is_listed + is_active` clubs (suspended/hidden never leak).

### 2FA for the single superadmin (locked 2026-09-28)- Step 1 (`POST /api/auth/login`, no slug, password OK) returns
  `{two_factor_required: true, challenge_id}` — never a session token.
- Step 2 (`POST /api/auth/verify-2fa {challenge_id, code}`) checks a 6-digit
  OTP (sha256, 2-min TTL, single-use, 5 attempts then lockout) delivered via
  Telegram to `SUPERADMIN_TELEGRAM_CHAT_ID` using `SUPERADMIN_TELEGRAM_BOT_TOKEN`
  (both Render secrets, no fallback in production). Failures count into the
  abuse-shield login bucket.
- Local dev without secrets logs the code to the server console (loud warning,
  never in production). Table `login_challenges` (`0020`); `/platform` login
  is a two-step UI (code screen after password).

### 10. Demo tenant — public sandbox, routinely reset
- One special club: slug `demo` (reserved, uncreatable via API), flagged
  `clubs.is_demo = true`. Excluded from plan enforcement and billing; listed
  first in `/clubs` with a "Try the demo" CTA and published credentials
  (`demo-admin / <rotated on reset>` or open sandbox login — decided at build).
- Content: seeded courts (tennis + padel), weekly timetable, sample bookings,
  blocks and announcements so prospects see every state (available/pending/
  blocked). Lives at `/club/demo/`.
- Demo run onboarding (locked 2026-09-27): "Start demo" provisions a **personal
  ephemeral run** from the pre-loaded template — the only two inputs are club
  name (free text, or "Surprise me" random generator, e.g. `Sunset Smash Club`)
  and courts picker (per type: tennis × N, padel × M steppers). No signup, no
  other config — timetable, settings, sample bookings/blocks come from template.
  - `POST /api/demo/start {display_name?, courts: [{type, count}]}` →
    creates club (`slug: demo-<random4>`, `is_demo: true`,
    `demo_expires_at: now + 24h`, required timezone defaults to `Europe/Rome`
    with visible selector? — no, keep zero-friction: template tz) + seeds
    courts/timetable/settings + demo admin user, returns
    `{slug, admin_credentials, url: /c/<slug>/}`.
  - Run TTL 24h; cleanup job deletes expired demo runs (same `is_demo`-asserted
    transaction pattern as below). Concurrent prospects never share state —
    the shared `/club/demo/` stays read-mostly showcase.
- Reset job (nightly + on-demand `POST /api/platform/clubs/demo/reset`
  superadmin-only): single transaction scoped to `WHERE club_id = demo_id` —
  wipe bookings/users-beyond-seed/blocks/settings deltas, re-run club seed.
  Job asserts `is_demo` before deleting (never a generic "reset club" endpoint).
- Crosstalk: reset/cleanup are the most dangerous writers in the system — test
  explicitly that they touch only demo rows (row-count assertions per table
  before/after on non-demo clubs).

### 11. Per-club locales (locked 2026-09-27)- Today i18n is global: 5 langs `it|en|fr|de|es`, `users.preferred_language`
  enum, `frontend/src/i18n/*.json`, header language switcher, per-lang
  announcement translations. Becomes club config: `app_settings.enabled_locales
  TEXT[] NOT NULL DEFAULT '{it,en,fr,de,es}'` + `default_locale VARCHAR(5) NOT
  NULL DEFAULT 'it'` (must be a member of `enabled_locales`, enforced on write).
- Single-locale club (e.g. `{it}`): frontend hides **all** language UI — no
  header switcher, no `preferred_language` sync (`PATCH /api/users/me` ignores
  it), no per-lang tabs on the announcement form (single body). Multi-locale
  clubs keep today's behaviour scoped to their enabled set.
- Backend: register/profile reject `preferred_language` outside the club set
  (`400`); `GET /api/club-info?slug=` includes `locales` + `default_locale` so
  the frontend boots without an extra round-trip; announcements serve only
  translations in enabled locales (others never created).
- Seed/backfill: existing club keeps all 5 (today's behaviour unchanged).

### 12. Club-admin 2FA, per-club opt-in (locked 2026-09-28)
- `app_settings.two_fa_enabled` (default false). When on, every club `admin`
  login is password → OTP (`login` purpose challenge, Telegram-first /
  WhatsApp-fallback to the admin's linked channel) → session. Members/visitors
  never challenged. `PUT /api/settings` rejects `two_fa_enabled` outright.
- Enable AND disable both OTP-gated: `POST /api/settings/2fa/code
  {action}` delivers to the caller's current channel,
  `POST /api/settings/2fa/confirm {action, code[, challenge_id]}` applies.
  Activation proves the admin can receive+relay before anything turns on.
- Contact guard: an admin changing `mobile`/`telegram_chat_id` (`PATCH
  /users/me`, admin `PATCH /users/:id`) must attach `two_fa_code` from a
  `contact` challenge (`POST /api/users/me/contact-challenge`, sent to the
  OLD channel). With valid code the change applies and 2FA stays on; without
  it the change applies but club 2FA is DISABLED (`two_fa_disabled: true` in
  the response) — an unverified channel can never stay enforced.
- Lockout recovery (no code changes — supported by construction):
  1. another healthy admin disables 2FA with their own OTP, fixes the contact,
     re-enables; 2. single-admin club: superadmin impersonates (grant flow,
     no club OTP needed), updates the contact — the guard auto-disables 2FA —
     admin re-links and re-enables. WhatsApp/mobile fallback also covers a
     lost Telegram link without any rescue.

### 13. Feature requests — club admins → platform board (locked 2026-09-30)
- Shared board across clubs, opposite direction of announcements (§2 analog,
  mirrored): any club `admin` submits; ALL club admins see ALL requests but
  origin stays anonymous (no club name/author in admin responses); superadmin
  sees the origin club+author; other clubs' admins `+1` requests they want.
- Tables (next migration after `0031`): `feature_requests (id, club_id NOT
  NULL → clubs cascade = origin, author_id → users SET NULL, title
  varchar(200), body text, status varchar(20) DEFAULT 'open', reply text
  NULL, created_at, updated_at)` + `feature_request_votes (request_id →
  cascade, user_id → cascade, club_id denormalized → cascade, created_at,
  UNIQUE (request_id, user_id))`. Status enum
  (`open|acked|planned|shipped|declined`) validated in Zod, not a PG type
  (fewer moving parts). No translations — stored as-written, read as-is.
- No RLS (cross-club by design, like platform tables — reviewed exception):
  anonymity + scoping enforced in code. Admin list strips `club_id/author`;
  superadmin endpoints require `requireSuperadmin` (`platform.ts:46` pattern).
- Club endpoints (`routes/feature-requests.ts`, `authenticate` +
  `requireRole(['admin'])` + `requireRequestClub`, announcements `123-153`
  pattern): `POST /api/feature-requests {title 1-200, body 1-5000}` (origin =
  caller's club); `GET /api/feature-requests` (all rows, anonymized
  `{id,title,body,status,reply,votes,mine,voted,created_at}`, sorted
  open-first then votes desc then newest); `PATCH /api/feature-requests/:id
  {title?,body?}` (own club only, only while `open`, else 403/400);
  `POST /api/feature-requests/:id/vote` (toggle; own-club votes 403;
  returns `{voted,votes}`).
- Platform endpoints (`routes/platform.ts`): `GET
  /api/platform/feature-requests` (full rows + club slug/name, author
  username, vote count); `PATCH /api/platform/feature-requests/:id {status?,
  reply?}` (any→any transition; reply visible to all club admins).
- No delivery push (inbox only, decided): no Brevo/Telegram on create. Audit
  both sides (`auditLog`: club-scoped create/edit/vote? — create+edit only,
  votes too noisy — plus `platform.featurereq.status` incl. reply).
- Frontend: club view `admin-requests` (submit form + board with +1 buttons,
  status chips, reply display, own-edit; nav next to `admin-announcements`,
  loader in the `main.ts:317-353` map); platform view `platform-requests`
  (table + status/reply editor). i18n `admin.requests.*` +
  `platform.requests.*` × 5 locales, flat keys.
- Tests (`feature-requests.test.ts`, `cleanSlate` + second club via `seedClub`
  pattern): anonymity (no club/author leak to admins), origin visible to
  superadmin, own-club vote/edit 403, vote toggle counts, edit-only-when-open,
  platform endpoints superadmin-only, validation lengths.
- Out of scope: associates submitting, attachments, comment threads (single
  superadmin `reply` field only), email/Telegram pings, translations.

### 5. Ops (small)
Same Render service + Neon DB. Env keeps platform secrets only; per-club creds
live in `app_settings`. Seed becomes "seed club".

## Crosstalk hotspots (test explicitly)
Public availability/timetable reads, Telegram webhook routing, the admin-union
notify query, reports aggregation, username/email login scoping.
Slug collisions/reserved words, `/` vs `/club/:slug/` routing, directory leaking
private club data.

## Phases
0. Backup single-tenant DB before touching anything (both local + Neon):
   `pg_dump -Fc` + plain `.sql`, timestamped under `backups/<env>_YYYYMMDD_HHMM/`,
   verify (`pg_restore --list` / row counts), keep until Phase 1 migration is
   proven on a restore. No destructive migration without a green restore test.
   Done 2026-09-27 → `Temp\opencode\backups_20260927_0233\`
   (`local.dump/.sql` valid, 72 TOC entries; `neon.dump/.sql` valid, 75 TOC).
   Baselines — local: users=3 courts=4 bookings=107 blocks=0 rules=2 settings=1;
   Neon: users=3 courts=4 bookings=15 blocks=0 rules=6 settings=1.
1. Schema + backfill migration, `clubs` table (incl. `slug` unique + reserved
   validation), per-club settings/timezone/locales.
2. Auth: club-scoped login/JWT/roles + superadmin.
3. Route-by-route scoping + Telegram routing.
4. Hardening: Postgres RLS (`current_setting('app.club_id')`) + per-endpoint
   cross-club tests. Done 2026-09-28 (`0016_rls`, 29/29 tests):
   non-owner app role + per-request `SET LOCAL` txn client (`attachClubClient`,
   committed/released onResponse) + `WITH CHECK` policies on all tenant tables
   (timetables/translations inherit via parent, clubs public-read). Trust-root
   owner-pool exceptions (reviewed): auth credential checks, webhook token
   bootstrap, demo provisioning (demo-only, asserted). No `FORCE` — owners
   (migrate/seed/dashboard) bypass by design.
    Runbook — local: `CREATE ROLE app_user LOGIN PASSWORD '…'` + CONNECT/USAGE/
    CRUD grants + `ALTER DEFAULT PRIVILEGES FOR ROLE postgres …` (same on Neon
    via SQL editor); runtime `DATABASE_URL`= app role, `AUTH_`/`OWNER_` vars =
    owner (migrate/seed/CLIs). Verified: dev server runs fully as app_user.
    Boot migrate (`render.yaml` startCommand) MUST run as owner: the app role
    cannot DDL and `IF NOT EXISTS` succeeds silently, so booting migrate as
    app_user reports success on a half-migrated DB. Prod incident 2026-09-28:
    Neon `login_challenges` missing while bookkeeping looked fine; fixed via
    Neon SQL editor (owner) + `migrate.ts` now self-verifies required
    tables/columns and exits 1 (red deploy) instead of booting half-migrated.
5. Frontend club context (`/club/:slug/` + `X-Club-Slug`) + per-club branding/links.
6. Platform frontend: `/` landing + `/clubs` directory + `GET /api/clubs` +
   `/club/:slug/` enforcement + slug deep links.
7. Platform admin: `superadmin` role + `/api/platform/*` + `/platform` UI +
   bootstrap seed + audit.
