# Features — wanted, done, out of scope

> Index only. Deep design lives in `SPEC.md` (single-club baseline) and
> `MULTITENANT.md` (multitenancy design).

## Wanted (not built yet)

| # | Feature | Notes |
|---|---------|-------|
| 23 | Notifications v2 — reachability × subscription × policy; email mandatory, push = WA/TG with master switch | SPEC agreed (chat 2026-09-29): user channels + per-event push toggles; admin Notify-users vs Admin-alerts tabs; send iff policy AND subscription AND channel connected |
| | ↳ 23a. User channels block: push master switch, WA number+verify+on/off, TG link/unlink+on/off, email read-only mandatory | |
| | ↳ 23b. User per-event push toggles (email locked ON); push cell greyed with reason when no push channel usable | |
| | ↳ 23c. Admin Notify-users tab: per event email and/or push policy | |
| | ↳ 23d. Admin Admin-alerts tab: per event email and/or push to all admins | |
| | ↳ 23e. Delivery engine (3-leg rule) + retire old events×channel matrix | |
| 26 | Explicit participant lists on bookings (admin bypass: free booking) — per-club option | MISSING: everything (design + build) |
| | ↳ 26a. Club admin decides whether this club requires bookings to list all players, picked from the users database | |
| | ↳ 26b. When required, the booking screen adds a field to search & pick users (associates) by username or email | |
| 30 | Club admin submits feature requests (in-app channel to the platform) | MISSING: everything (design + build) |
| 16 | Online payment collection (Stripe/subscriptions/player checkout) | later candidate, was `SPEC.md:20` non-goal |
| 17 | Peak/off-peak price rules, discounts, memberships | later candidate |
| 18 | Tournaments (brackets, scheduling, court assignment, entries) | later candidate |
| 19 | Player & team rankings (per-sport points, levels, leaderboards) | later candidate |
| 20 | Social login alt route (OAuth Google/Apple; identity stays club-scoped) | later candidate |

## Done (live on prod unless noted)

- #1 single-club booking (courts, timetable, availability, bookings, blocks)
- #2 auth + roles (`associate|admin`, JWT 15m + refresh 7d)
- #3 i18n 5 langs + theme centralisation
- #4 notifications v1 (Telegram/WhatsApp, admin queue)
- #5 multitenancy core (clubs, `club_id` scoping, per-club settings/timezone)
- #6 incremental test coverage (vitest, endpoint + cross-club)
- #7 club slug + deep links (`/club/:slug/`)
- #8 platform frontend (`/` landing + `/clubs` directory)
- #9 platform admin (`superadmin`, `/api/platform/*`, `/platform` UI)
- #10 platform pricing display (tiers, plan per club; billing manual)
- #11 court rental pricing display (per-court price, snapshot, revenue reports)
- #12 demo tenant (public sandbox, routine reset)
- #13 abuse shield (IP blacklist, rate limits)
- #14 superadmin 2FA (Telegram OTP)
- #15 per-club locales
- #24 flexible slot grids (windows, midday gaps, copy bar, `flexible_slots` flag)
- #25 admin-managed accounts (`allow_open_signup`, register gate, welcome mail)
- #27 password reset via email + self-service change
- #28 Brevo transactional email pipe + platform test-send
- #29 per-window pricing + `show_prices` master switch

## Out of scope (dropped)

- #21 calendar sync, native apps, realtime chat
- #22 memberships join table — consequence: multi-club players keep one login per club

## Notes — Massimo (prospect, next release)

- #23–#26 are **per-club admin options**, never global mandates: each club toggles them in settings; defaults keep current behaviour.
- #24 covered three shapes: fully custom slots, constant grids, midday break (multiple open windows per day).
- #27 was needed in any case (support + onboarding), independent of notification content.
- #28 was the infrastructure prerequisite: no SMTP on Render, Brevo chosen.

## Rules

- New feature requests land here first (top table) before any design doc grows.
- Tests are incremental: every feature ships with its vitest coverage, no big-bang test phase.
- `MULTITENANT.md` stays a design doc for features 5–15, not the list itself.
