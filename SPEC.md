# Bagel Club — Tennis & Padel Court Booking Web App — Specification

> Version: 0.1.7 (Draft) — 2026-09-23
> Status: Implementation — profile (mobile/gender/birthdate) + booking edit (notes/players/rent)
> Stack: Frontend HTML + lightweight JS framework (Aurora-like) · Backend Node.js + TypeScript (Fastify + Drizzle) · PostgreSQL · Mobile-first · i18n (5 langs) · Deploy: Render.com (single Web Service)

---

## 1. Overview

**Bagel Club** is a web app for booking tennis and padel courts at a club.

Goals:
- Allow club members (associates), visitors, and admins to manage and book courts from any device, prioritizing mobile.
- Give admins full control over court inventory, operating hours, booking lifecycle and availability blocks.
- Provide a simple deferred-registration booking flow for visitors (browse/book → register → confirm).
- Persist identity with `username`, `hashed_password`, `email`, `first_name`, `last_name`.
- Leave clear extension points for future features: **player rankings** and **club tournaments**.

Non-goals for MVP: payments, native mobile apps, real-time chat, external calendar sync (Google/Apple) — all deferred.

---

## 2. Personas & Roles

### 2.1 Club Visitor (Unauthenticated / Guest)
- Not yet a registered user. Can browse courts and availability without an account.
- Can *select* a desired slot (court + date + time) — **no booking row is created** while anonymous. Intent is stored only locally (frontend `localStorage`).
- Booking is **created only after registration** completes (`POST /api/bookings` with JWT). No `pending_registration` hold is stored for anonymous users.
- After registration, becomes an `associate` or retains `visitor` role with booking history.

> Decision needed: Does a visitor auto-promote to `associate` after first confirmed booking, or remain `visitor` until admin upgrades? Proposed: `visitor` is a persistent role; association is a separate admin-managed flag/status.

### 2.2 Club Associate (Authenticated Member)
- Registered user with verified email. Member of the club (may have membership ID/discount — stub for future).
- Can view availability, create booking requests, view/cancel own bookings, see booking status (pending / approved / rejected / cancelled).
- Can edit own profile.

### 2.3 Club Admin
- Manages everything: users, courts, timetable, bookings, blocks.
- Can approve/reject booking requests.
- Can define scheduled blocking rules (e.g., maintenance, lessons, closed hours) and ad-hoc blocks.
- Full read access to all bookings and users. Can impersonate/debug with audit log.

### Roles Matrix (RBAC)

| Capability | Visitor (guest) | Visitor/Associate (auth) | Admin |
|---|---:|---:|---:|
| Browse courts & availability | ✓ | ✓ | ✓ |
| Initiate booking request | ✓ (local intent, no DB) | ✓ | ✓ (on behalf) |
| Confirm booking (after register) | ✓ booking created post-register | ✓ immediate pending | — |
| View own bookings | — | ✓ | ✓ |
| Cancel own pending booking | — | ✓ | ✓ |
| View all bookings | — | — | ✓ |
| Approve / Reject bookings | — | — | ✓ |
| CRUD courts | — | — | ✓ |
| Define timetable / operating hours | — | — | ✓ |
| Create blocking rules / ad-hoc blocks | — | — | ✓ |
| Manage users / roles | — | — | ✓ |

Auth: **JWT** (short-lived access 15m + refresh 7d, stored in httpOnly cookie or Authorization header) — decided. Password stored as `argon2id` hash. Email verification recommended (non-blocking for MVP).

---

## 3. Domain Model

### 3.1 Core Entities

**User**
- `id` UUID PK
- `username` VARCHAR unique, 3-30, `^[a-zA-Z0-9_.-]+$`
- `email` VARCHAR unique, validated
- `password_hash` TEXT (argon2id/bcrypt)
- `first_name`, `last_name` VARCHAR
- `role` ENUM: `associate`, `admin`
- `preferred_language` ENUM: `it`, `en`, `fr`, `de`, `es` — default `it`, persisted per user
- `preferred_sport` ENUM: `tennis`, `padel` nullable — preferred sport, presets timetable filter (not mandatory)
- `mobile` VARCHAR(20) nullable — mobile number
- `gender` ENUM: `male`, `female`, `other`, `prefer_not_to_say` nullable
- `birthdate` DATE nullable
- `is_verified` BOOLEAN (email verified)
- `created_at`, `updated_at`
- Future: `membership_number`, `ranking_points`, `ranking_category`

**Court**
- `id` UUID PK
- `number` INT unique (display number, e.g., 1..N)
- `type` ENUM: `tennis`, `padel`
- `name` VARCHAR optional (e.g., "Central Padel 1")
- `surface` VARCHAR optional (e.g., clay, synthetic)
- `is_active` BOOLEAN (soft disable without delete)
- `created_at`, `updated_at`

**Timetable / Operating Hours**
- Defines when courts *can* be booked. Admin-configured. **Slot duration is configurable per court** (decided) — padel often 90 min, tennis 60 min.
- `id` UUID PK
- `court_id` UUID FK nullable (null = global default, otherwise court-specific override)
- `day_of_week` SMALLINT 0-6 (0=Sunday) or `date` for exception
- `open_time`, `close_time` TIME (e.g., 08:00-22:00)
- `slot_duration_minutes` INT default 60 (allowed: 30, 60, 90, 120 — per-court config, fallback to `app_settings.default_slot_duration`)
- `is_closed` BOOLEAN (closed all day)
- Unique constraint on `(court_id, day_of_week)` where global.

**Booking**
- `id` UUID PK
- `court_id` UUID FK
- `user_id` UUID FK **NOT NULL** (booking only created for authenticated user; legacy nullable + `guest_token`/`expires_at` kept for migration compat but unused in new flow)
- `date` DATE
- `start_time`, `end_time` TIME (or `start_at`, `end_at` TIMESTAMPTZ)
- `status` ENUM: `pending_approval`, `approved`, `rejected`, `cancelled` (+ legacy `pending_registration`, `expired` kept but not created for new bookings)
- `notes` TEXT nullable — optional user notes for admin (max 1000 chars, shown in confirmation screen + admin queue + my bookings)
- `rent_racquets` INT NOT NULL default 0 CHECK (0-4) — number of racquets to rent, selected in confirm screen (0-4)
- `players` INT NOT NULL CHECK (2 or 4) — number of players; UI shows radio **Single / Double** (single=2, double=4); default tennis Single (2), padel Double (4)
- `guest_token` VARCHAR nullable (legacy, deprecated — no longer used)
- `expires_at` TIMESTAMPTZ nullable (legacy, deprecated)
- `reviewed_by` UUID FK nullable (admin)
- `created_at`, `updated_at`

Constraint: no overlapping `approved`/`pending_approval` bookings for same `court_id` + time range. Enforce with exclusion constraint (PostgreSQL `EXCLUDE USING gist`).

**Block / Blocking Rule**
Two levels:
1. **Ad-hoc Block**: single blocked slot range (e.g., 2026-10-01 14:00-16:00 on Court 2 for maintenance).
   - `id`, `court_id` (nullable = all courts), `start_at`, `end_at`, `reason`, `created_by`
2. **Scheduled / Recurring Rule**: weekly recurrence (e.g., every Mon 09:00-12:00 Court 1 reserved for lessons).
   - `id`, `court_id` (nullable), `day_of_week`, `start_time`, `end_time`, `reason`, `valid_from`, `valid_until`, `is_active`
- Blocks make slots unavailable and take precedence over timetable. Bookings overlapping a block must be rejected.

**App Settings** (`app_settings` table — single row + admin UI)
- `default_slot_duration_minutes` INT default 60
- `booking_hold_minutes` INT default 30 (TTL for `pending_registration`)
- `max_advance_days` INT default 14
- `min_cancel_hours` INT default 2
- `auto_approve_bookings` BOOLEAN default FALSE — **configurable** (decided): when TRUE, `pending_approval` → `approved` automatically; when FALSE, admin must approve/reject. Admin toggles via `PUT /api/settings`.

### 3.2 Relationships Diagram

```
User 1──* Booking *──1 Court
Court 1──* Timetable (weekly)
Court 1──* Block (ad-hoc)
Court 1──* BlockingRule (recurring)
User 1──* Booking (reviewed_by) [admin]
```

### 3.3 Future Entities (stubbed, not in MVP)
- `Ranking` / `PlayerStats` — `user_id`, `sport_type`, `points`, `level`, `matches_played`
- `Tournament` — `id`, `name`, `sport_type`, `start_date`, `end_date`, `format` (single elim, round robin), `status`
- `TournamentEntry` — `tournament_id`, `user_id`, `seed`
- `Match` — `tournament_id`, `court_id`, `player_a`, `player_b`, `score`, `scheduled_at`

Ensure `User` and `Court.type` already support this without migration.

---

## 4. Booking Lifecycle & Business Rules

### 4.1 States

```
[Visitor selects slot] ──(stored locally, no DB)──→ [registers] ──→ pending_approval ──(admin approves)──→ approved
                                                            │──(admin rejects)──→ rejected
                                                            └──(user cancels)──→ cancelled
[Associate selects slot] ──→ pending_approval ──→ (same as above)
Legacy: pending_registration / expired kept for backwards compat but not created for new visitor bookings
```

### 4.2 Flow — Visitor (deferred registration) — updated 2026-09-23: no anonymous DB hold + confirm screen

1. Visitor browses `/courts` → picks court type, date, available slot (computed from timetable minus bookings minus blocks).
2. Clicks "Book" → **no DB write**. Frontend stores intent locally: `{court_id, date, start_time}` in `localStorage` (`pending_booking_intent`) and navigates to **confirm screen** (or register if unauth). Confirm shows court, date, time + optional **notes textarea** for admin.
3. If unauthenticated: prompted to register: `username`, `email`, `password`, `first_name`, `last_name`, `preferred_language`. On submit, user created (`POST /api/auth/register`), JWT returned, then frontend creates booking: `POST /api/bookings {court_id, date, start_time, notes?}` with JWT → status `pending_approval` (or `approved` if `auto_approve_bookings=true`).
4. If authenticated: confirm screen → **Confirm** → `POST /api/bookings {court_id, date, start_time, notes?}` directly.
5. Admin sees `pending_approval` queue with notes, approves/rejects. On approval, booking → `approved` and user notified.

### 4.3 Flow — Associate (authenticated)

1. Picks slot → **confirm screen** with optional notes → confirms → creates `Booking` with `status=pending_approval` (notes persisted).
2. If `app_settings.auto_approve_bookings = false` (default), admin approves/rejects. If `true`, system auto-transitions `pending_approval` → `approved` immediately (still creates audit entry, still checks blocks/overlaps).

### 4.4 Rules

- Slot duration **per-court configurable** (30/60/90/120 min). Availability splits using court-specific `slot_duration_minutes`. No partial overlaps; multi-slot bookings (e.g., 2h = 2×60) allowed only as consecutive slots if admin enables.
- No double-booking: DB exclusion constraint + app-level check.
- `max_advance_days` (e.g., 14 days) — cannot book beyond horizon.
- `min_cancel_hours` (e.g., 2h before start) — associates can cancel pending/approved up to threshold; admin can always cancel.
- Cancellation policy, club-defined (locked 2026-10-01): `cancel_policy` =
  free cancellation until `min_cancel_hours` before start; after the
  deadline the user cannot self-cancel (admin still can). Admin may mark a
  kept-but-unused booking as `no_show` for reporting; repeated no-shows are
  report-only, never auto-ban.
- Booking payment policy, club-defined (locked 2026-10-01):
  `booking_payment_mode` = `on_court` (pay at the club, default, always
  available) or `upfront` (pay online at booking time). `upfront` is
  selectable only when online payments are live for the club (Go/Pro plan +
  provider connected, #16); otherwise the club stays `on_court`.
  `bookings.payment_status` = `unpaid | paid | onsite`; reports split revenue
  by status. Unpaid-upfront bookings follow #16 checkout expiry, never silent
  holds.
- Blocks override everything. Scheduled rules are expanded at query time to generate blocked slots.
- Timezone: store `TIMESTAMPTZ` in UTC, render in club local timezone (configurable, default `Europe/Rome` or similar). Day boundaries per club TZ.
- Notifications: email on `pending_approval` → admin, `approved`/`rejected` → user. In-app toast for MVP.

---

## 5. Admin Capabilities

### 5.1 Court Management
- CRUD courts: number (unique), type, name, surface, active toggle.
- Deactivating a court hides it from booking but preserves history. Existing future bookings must be handled (warn + bulk cancel/reassign).

### 5.2 Timetable
- Global default weekly schedule + per-court overrides.
- UI: 7-day grid (Mon-Sun) with open/close times and slot duration. Toggle closed days.
- Exception dates (holidays) as ad-hoc blocks or timetable exceptions.

### 5.3 Blocking
- **Ad-hoc block**: pick court(s), date, time range, reason. Immediate effect.
- **Scheduled rule**: pick court(s), weekday(s), time range, validity window, reason. Recurring weekly. Toggle active/inactive.
- Validation: block cannot be in the past; warn if it overlaps existing approved bookings (admin chooses to keep or cancel affected bookings).

### 5.4 Booking Moderation
- Queue view: filters by status, court, date, user. Sort by created_at.
- Actions: Approve, Reject (with reason), Cancel. Bulk actions for future.
- Audit: who reviewed, when, reason.

---

## 6. API Design (Backend — Node.js + TypeScript + PostgreSQL)

### 6.1 Tech Choices (locked)
- **Runtime**: Node.js 20+ · **Language**: TypeScript 5.x (strict mode) · **Framework**: Fastify 4+ (locked — `fastify-static` for frontend, `fastify-jwt`, `fastify-cors`)
- **DB**: PostgreSQL 16 · **ORM**: Drizzle ORM (locked, native TypeScript) + raw SQL for exclusion constraints (`btree_gist`)
- **Auth**: `argon2id` for hashing · `jose`/`fastify-jwt` for JWT (access 15m + refresh 7d via httpOnly cookie) — locked. `zod` for validation.
- **Jobs**: `node-cron` in-process for MVP (or Render Cron Job `*/5 * * * *` calling `npm run jobs:expire`) — both supported
- **Validation**: Zod schemas as single source of truth, inferred TS types shared with frontend
 - **Tooling**: `tsx` for dev, `tsc` for build, `eslint` + `prettier`, `vitest` + `supertest` for tests. All backend source under `backend/src/**/*.ts`. `drizzle-kit` for migrations.

### 6.2 REST Endpoints (MVP)

```
Auth
POST   /api/auth/register          {username,email,password,first_name,last_name,preferred_language?,guest_token?} // preferred_language: it|en|fr|de|es
POST   /api/auth/login             {username|email, password}
POST   /api/auth/logout
POST   /api/auth/verify-email      (future)

Users
GET    /api/users/me               → { id, username, email, role, preferred_language, first_name, last_name, mobile, gender, birthdate }
PATCH  /api/users/me               {username?, email?, first_name?, last_name?, preferred_language?, mobile?, gender?, birthdate?} // profile page edits
GET    /api/users                  (admin)
PATCH  /api/users/:id/role         (admin)
PATCH  /api/users/:id/language     (admin or self) {preferred_language}

Courts
GET    /api/courts                 ?type=tennis|padel&active=true
POST   /api/courts                 (admin)
PATCH  /api/courts/:id             (admin)
DELETE /api/courts/:id             (admin — soft)

Timetable
GET    /api/timetable              ?court_id=
PUT    /api/timetable              (admin) bulk upsert weekly schedule
GET    /api/timetable/exceptions   (future)

Availability
GET    /api/availability           ?court_id=&date=YYYY-MM-DD&type=
       → returns slots: { start, end, status: available|booked|blocked|closed }

Bookings
POST   /api/bookings               {court_id, date, start_time, notes?, rent_racquets?, players?} (auth only — notes 0-1000, rent_racquets 0-4 default 0, players 2|4 (UI Single/Double) default tennis Single=2/padel Double=4; all shown to admin)
PATCH  /api/bookings/:id           {notes?, rent_racquets?, players?} (owner only, while pending_approval/approved — can edit only notes/players/rent)
POST   /api/bookings/intent        {court_id, date, start_time} (deprecated, kept for compat — no longer used; returns 410 or no-op)
GET    /api/bookings               ?mine=true | (admin: all, filters)
GET    /api/bookings/:id
POST   /api/bookings/:id/approve   (admin)
POST   /api/bookings/:id/reject    (admin) {reason}
POST   /api/bookings/:id/cancel    (owner or admin)

Blocks
GET    /api/blocks                 (admin) ?from=&to=
POST   /api/blocks                 (admin) {court_id?, start_at, end_at, reason}
DELETE /api/blocks/:id             (admin)
GET    /api/blocking-rules         (admin)
POST   /api/blocking-rules         (admin)
PATCH  /api/blocking-rules/:id     (admin)
DELETE /api/blocking-rules/:id     (admin)

Settings (admin)
GET    /api/settings               (admin) → { default_slot_duration_minutes, booking_hold_minutes, max_advance_days, min_cancel_hours, auto_approve_bookings }
PUT    /api/settings               (admin) { auto_approve_bookings?, default_slot_duration_minutes?, ... }

Health
GET    /health                     → { status: "ok", db: "up" }
GET    /api/health                 (alias)
```

All admin routes behind `role=admin` middleware (JWT verified). Guest intent rate-limited. CORS origin = frontend URL (same-origin when single service).

### 6.3 Suggested PostgreSQL Schema (excerpt)

```sql
-- Drizzle schema mirrors this SQL; keep as source of truth for migrations
CREATE TYPE user_role AS ENUM ('associate','admin');
CREATE TYPE court_type AS ENUM ('tennis','padel');
CREATE TYPE booking_status AS ENUM ('pending_registration','pending_approval','approved','rejected','cancelled','expired');

CREATE TYPE preferred_language AS ENUM ('it','en','fr','de','es');
CREATE TYPE gender AS ENUM ('male','female','other','prefer_not_to_say');
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL CHECK (username ~ '^[a-zA-Z0-9_.-]{3,30}$'),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'associate',
  preferred_language preferred_language NOT NULL DEFAULT 'it',
  mobile VARCHAR(20),
  gender gender,
  birthdate DATE,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE courts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number INT UNIQUE NOT NULL,
  type court_type NOT NULL,
  name TEXT,
  surface TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE timetables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  court_id UUID REFERENCES courts(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time TIME,
  close_time TIME,
  slot_duration_minutes INT NOT NULL DEFAULT 60 CHECK (slot_duration_minutes IN (30,60,90,120)),
  is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (court_id, day_of_week)
);

CREATE TABLE app_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_slot_duration_minutes INT NOT NULL DEFAULT 60,
  booking_hold_minutes INT NOT NULL DEFAULT 30,
  max_advance_days INT NOT NULL DEFAULT 14,
  min_cancel_hours INT NOT NULL DEFAULT 2,
  auto_approve_bookings BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO app_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  court_id UUID NOT NULL REFERENCES courts(id),
  user_id UUID REFERENCES users(id),
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status booking_status NOT NULL,
  notes TEXT,
  rent_racquets INT NOT NULL DEFAULT 0 CHECK (rent_racquets BETWEEN 0 AND 4),
  players INT NOT NULL DEFAULT 2 CHECK (players IN (2,4)),
  guest_token TEXT,
  expires_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);
-- Add exclusion constraint for overlaps (requires btree_gist):
-- CREATE EXTENSION IF NOT EXISTS btree_gist;
-- ALTER TABLE bookings ADD CONSTRAINT no_overlap EXCLUDE USING gist (
--   court_id WITH =, daterange(date, date, '[]') WITH &&, tstzrange(...) WITH &&
-- ) WHERE (status IN ('pending_approval','approved'));

CREATE TABLE blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  court_id UUID REFERENCES courts(id) ON DELETE CASCADE,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);

CREATE TABLE blocking_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  court_id UUID REFERENCES courts(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  reason TEXT NOT NULL,
  valid_from DATE,
  valid_until DATE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK (end_time > start_time)
);
```

---

## 7. Frontend (HTML + Lightweight JS — Mobile-First)

### 7.1 Framework Choice
Requirement: "Aurora or something similar, lightweight yet powerful". Aurora is not a well-known framework — interpret as **Alpine.js-like** (reactive, declarative, no build-heavy SPA). Candidates:

| Option | Size | Why consider |
|---|---|---|
| **Alpine.js** | ~14kb | Closest to "Aurora" description, declarative `x-data`, perfect for progressive enhancement, pairs with server-rendered HTML |
| **Lit** | ~5kb | Web components, great for reusable court/slot widgets |
| **Preact** | ~4kb | React-compatible, slightly heavier but familiar |
| **Solid / Svelte** | ~7-10kb | Compile-time, very performant |

**Proposed**: **Alpine.js + HTML (server-rendered via Node templating — e.g., EJS/Nunjucks or Fastify View) + Tailwind CSS**. Alternative: **Astro** with Alpine islands if SSR/SSG desired. Keep a JSON API so frontend can later swap to any SPA without backend changes.

### 7.2 Pages / Routes

```
 /                        Landing — hero, court types, CTA to book
 /courts                  Browse courts (filter tennis/padel, availability hint)
 /courts/:id              Court detail + date picker + slot grid
 /book                    Booking flow (slot selected → register/login → confirm)
 /login, /register        Auth
 /me/bookings             Own bookings (tabs: upcoming/past, status badges)
 /me/profile              Edit profile
 /admin                   Dashboard (stats, pending queue count)
 /admin/courts            CRUD courts
 /admin/timetable         Weekly grid editor
 /admin/blocks            Blocks & recurring rules
 /admin/bookings          Moderation queue
 /admin/users             User list (future)
```

### 7.3 UX — Mobile-First Principles
- Bottom nav / sticky CTA on mobile for "Check availability / Book".
- Slot grid: horizontal time scroll, color-coded states (available green, blocked gray, booked red, selected blue). Tap to select.
- Date picker: native `<input type="date">` + quick chips (Today, Tomorrow).
- Offline-tolerant: optimistic slot hold with countdown timer for `pending_registration` (e.g., "23:14 to complete registration").
- Accessibility: semantic HTML, keyboard-navigable slots, ARIA for status.
- Performance budget: <50kb JS, <100kb CSS, LCP <2.5s on 3G.

### 7.4 State & Data Fetching
- Alpine stores for `auth`, `availability`, `bookingIntent`, `i18n` (`lang`, `t()`).
- Fetch via `fetch` to `/api/*` with credentials. Handle 401 → redirect to /login?next=.
- Guest token stored in `localStorage` + cookie for intent recovery.
- i18n: `frontend/src/i18n/index.ts` loads `it/en/fr/de/es` JSON, `localStorage.lang` persisted, `PATCH /api/users/me` syncs when authed, `document.documentElement.lang` set.

---

## 8. Auth & Security (locked: JWT)

- **Strategy**: JWT — `fastify-jwt` + `jose`. Access token 15m (Authorization: Bearer), refresh token 7d in httpOnly Secure SameSite cookie. `POST /api/auth/refresh` rotates refresh.
- Passwords: `argon2id` (preferred) — never log raw.
- Username + email unique. Email normalized (lowercase). Verification email on register (non-blocking for MVP; `is_verified` flag).
- Rate limiting: login 5/min/IP, intent 10/min/IP, register 3/min/IP (`@fastify/rate-limit`).
- CORS: same-origin when serving static frontend from Fastify; otherwise locked to `CORS_ORIGIN` (Render frontend URL). No CSRF needed for Bearer JWT; if refresh via cookie, add CSRF double-submit.
- RBAC middleware checks `role` claim on every admin route (`visitor|associate|admin`).
- Audit log table for admin actions (approve/reject/block/settings) — `audit_log(id, actor_id, action, target, meta, created_at)`.

---

## 9. Availability Computation (core algorithm)

```
function getAvailability(court, date):
  timetable = getTimetable(court, dayOfWeek(date))
  if timetable.is_closed: return []
  slot_duration = timetable.slot_duration_minutes ?? app_settings.default_slot_duration_minutes
  slots = splitIntoSlots(timetable.open_time, timetable.close_time, slot_duration)
  blocks = expandBlocks(court, date) // ad-hoc + recurring rules expanded
  bookings = getBookings(court, date, status in [pending_approval, approved]) // legacy pending_registration excluded — not created for new visitor bookings
  for slot in slots:
    if overlaps(slot, blocks): status=blocked
    else if overlaps(slot, bookings): status=booked
    else status=available
  return slots
```

Cache per `court+date` for ~30s. Invalidate on booking/block/timetable change.

---

## 10. Non-Functional Requirements

- **Mobile-first, responsive**: 320px → 1440px, touch targets ≥44px, no hover-only interactions.
- **i18n**: Frontend localised in **Italian, English, French, German, Spanish** (5 languages). All strings via `frontend/src/i18n/` JSON (it/en/fr/de/es), `t(key)` helper, `Intl` for dates/numbers. Language selector in header + mobile nav. Guest: `localStorage.lang` + `navigator.language` fallback; Authenticated: `users.preferred_language` persisted, included in JWT, synced on `PATCH /api/users/me`. `Accept-Language` header respected for future SSR.
- **A11y**: WCAG 2.1 AA (lang attribute `html[lang]` updated on switch).
- **Observability**: structured logs (pino), health check `/health`, DB migration tool (e.g., `node-pg-migrate` with TS migrations).
- **Type Safety**: `strict: true` in `tsconfig.json`, no `any` without justification, Zod schemas as single source of truth for API validation + inferred types.
- **Deployment (Render.com)**: All services deployed on **Render.com** via Blueprint (`render.yaml`). No self-managed Docker host / VPS. See §11.1 for details.
- **Backups**: Render PostgreSQL daily automated backups + PITR (retention per Render plan); plus logical dumps before destructive migrations.

---

## 11. Project Structure & Deployment (Render.com)

### 11.1 Deployment Target — Render.com

Everything is deployed on **Render.com**. No separate VPS/Docker host.

**Recommendation for your pattern (opinion): stick with single Web Service serving pre-built frontend via Fastify — your familiar `express.static` pattern, but with Fastify.** This is simpler/cheaper on Render than a separate Static Site, avoids CORS, and keeps one health check / one deploy. Build frontend then have Fastify serve `frontend/dist` with fallback to `index.html` for SPA routing. Only split to a separate Static Site if you need edge CDN or independent frontend deploys.

| Service | Render Type | Source | Build | Start | Notes |
|---|---|---|---|---|---|
| **API + Frontend** (`empanadel-api`) | Web Service (Node) | repo root | `npm ci --prefix backend && npm run build --prefix backend; npm ci --prefix frontend && npm run build --prefix frontend` | `npm run migrate --prefix backend && npm start --prefix backend` (`node backend/dist/app.js` serves `frontend/dist` via `@fastify/static`) | Single service. Health check `GET /health` (200). Auto-deploy on `main` push. env: `DATABASE_URL` (from PG), `JWT_SECRET`, `CORS_ORIGIN` (same-origin → no CORS), `CLUB_TIMEZONE`. Fallback: `GET /*` → `index.html` (SPA) after `/api/*` |
| **PostgreSQL** (`empanadel-db`) | Render PostgreSQL 16 | — | — | — | Managed PG. `DATABASE_URL` injected. Enable `btree_gist` extension. Plan defines backup retention/PITR. |
| **Expire-holds job** | Cron Job *or* in-process | `backend/` | same as API | `npm run jobs:expire` | Runs every `*/5 * * * *` to expire `pending_registration` bookings (`expires_at < now()`). For single-service MVP, in-process `node-cron` is fine; extract to Render Cron Job when scaling to multiple instances. |

Alternative (if you prefer split): deploy `frontend/` as Render **Static Site** with `VITE_API_URL` → API URL; then set `CORS_ORIGIN` to static site URL and keep API as pure JSON.

**Blueprint — `render.yaml` (IaC) at repo root — single-service (recommended):**
```yaml
services:
  - type: web
    name: empanadel-api
    runtime: node
    plan: starter
    region: frankfurt # or oregon — pick closest to club
    branch: main
    buildCommand: npm ci --prefix backend && npm run build --prefix backend && npm ci --prefix frontend && npm run build --prefix frontend
    startCommand: npm run migrate --prefix backend && npm start --prefix backend
    healthCheckPath: /health
    envVars:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        fromDatabase: { name: empanadel-db, property: connectionString }
      - key: JWT_SECRET
        generateValue: true
      - key: CLUB_TIMEZONE
        value: Europe/Rome
      # CORS_ORIGIN not needed for single-service (same-origin); set only if splitting frontend to Static Site
      # - key: CORS_ORIGIN
      #   sync: false

databases:
  - name: empanadel-db
    plan: starter
    region: frankfurt
    postgresMajorVersion: 16
```
For split frontend (alternative), add a second `type: web` service with `rootDir: frontend` as Static Site and re-enable `CORS_ORIGIN`. For expire-holds as separate cron, add:
```yaml
  - type: cron
    name: empanadel-expire-holds
    runtime: node
    schedule: "*/5 * * * *"
    rootDir: backend
    buildCommand: npm ci && npm run build
    startCommand: npm run jobs:expire
```

**Additional Render concerns:**
- **Environments**: `production` (main) + `preview` (PR previews auto-created for Web Service).
- **Secrets**: `JWT_SECRET`, `SESSION_SECRET`, `DATABASE_URL` never committed; set via Render dashboard or `sync: false`.
- **Migrations**: run on start (`npm run migrate` with `node-pg-migrate` / `drizzle-kit` in TS). Must be idempotent and backward-compatible.
- **Logs & metrics**: Render log streams + `pino` JSON logs; alerts on health check failure / 5xx.
- **Scaling**: start on `starter` plan, scale vertically as needed. Stateless API — horizontal scaling safe (sticky not required if JWT; if cookie-session use external PG session store).
- **Local dev parity**: `docker-compose.yml` remains for local Postgres + API, but production is Render-managed (no `docker-compose` on Render).

### 11.2 Project Structure (proposed)

```
/
├── SPEC.md
├── README.md
├── render.yaml                 # Render Blueprint (IaC)
├── docker-compose.yml          # local dev only (Postgres + API)
├── backend/
│   ├── src/
│   │   ├── app.ts              # Fastify setup
│   │   ├── routes/             # auth, courts, bookings, blocks, availability (*.ts)
│   │   ├── services/
│   │   ├── db/                 # migrations, schema (*.ts)
│   │   ├── middleware/         # auth, rbac, error
│   │   ├── types/              # shared TS types / Zod schemas
│   │   └── jobs/               # expire holds (also runnable as Render Cron)
│   ├── tsconfig.json
│   ├── package.json            # scripts: build, start, migrate, jobs:expire
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── pages/              # HTML templates
│   │   ├── components/         # court-card, slot-grid, etc.
│   │   ├── stores/
│   │   └── main.js
│   ├── public/
│   └── package.json            # VITE_API_URL for Render Static Site
└── docs/                       # wireframes, decision logs
```

---

## 12. MVP Scope & Phases

### Phase 1 — MVP (this spec)
- [ ] Auth (register/login, visitor deferred flow with TTL, roles)
- [ ] Court CRUD (admin)
- [ ] Timetable (global + per-court weekly)
- [ ] Availability endpoint + slot grid UI
- [ ] Booking intent → pending_approval → approve/reject (admin)
- [ ] Ad-hoc blocks + scheduled recurring rules
- [ ] My bookings + admin queue
- [ ] Mobile-first styling

### Phase 2 — Hardening
- Email verification + notifications, audit log, expiration cron, rate limiting, tests (Vitest + Playwright), overlap exclusion constraint.

### Phase 3 — Future (explicitly out of MVP)
- Player rankings (per sport), leaderboards
- Club tournaments (brackets, scheduling, court assignment)
- Payments / membership tiers
- Calendar sync (iCal/Google)
- Waitlist, recurring bookings for members

---

## 13. Open Questions for Stakeholder

1. ~~Should visitor bookings auto-approve or always require admin approval?~~ **Decided 2026-09-23**: configurable via `app_settings.auto_approve_bookings` (default `false` = admin approval required). Admin toggles at `PUT /api/settings`.
2. ~~Visitor → associate promotion: automatic or admin-gated?~~ **Dropped with the visitor role — every member is an associate.**
3. ~~Slot duration: fixed 60 min or configurable per court/sport?~~ **Decided 2026-09-23**: configurable per court via `timetables.slot_duration_minutes` (30/60/90/120) with global default in `app_settings.default_slot_duration_minutes`.
4. Max advance booking window and cancellation policy? (Default: `max_advance_days=14`, `min_cancel_hours=2` — confirm.)
5. Club timezone and operating hours defaults? (Default: `Europe/Rome` — confirm.)
6. Should associates have booking quotas (e.g., 2 active bookings max)? (Still open — propose 3 active max for MVP.)
7. Notification channel: email only or also SMS/WhatsApp? (Proposed: email + in-app toast for MVP.)
8. Do we need to support booking multiple consecutive slots (e.g., 2h)? (Proposed: single-slot MVP, multi-slot as consecutive bookings later.)

---

## 14. Acceptance Criteria (MVP done when)

- Admin can create 4 courts (2 tennis, 2 padel), set Mon-Sun timetable, add a recurring Monday-morning block on Court 1, and see it reflected as unavailable.
- Visitor on mobile can pick an available slot, is prompted to register (username/email/password/first/last name), and upon registration sees booking in `pending_approval`.
- Admin can approve the booking; visitor sees it as `approved` and slot is no longer bookable.
- Overlapping booking attempts are rejected at API and DB level.
- `pending_registration` intents expire and free the slot without manual intervention.
- All pages usable on 375px viewport without horizontal scroll.

---

*Next step: profile page (username/email/lang/mobile/gender/birthdate) + booking edit (notes/players/rent) implemented.*
