# Features

> Index only. Deep design lives in `SPEC.md` (single-club baseline) and
> `MULTITENANT.md` (multitenancy design).

## Pending

| # | Feature | Notes |
|---|---------|-------|
| 31 | Usage-based tiers (metering + allowances + gates + soft billing) | SPEC'd 2026-10-01 (`MULTITENANT.md` §8-A2: monthly bookings+actives, 80/100% audit+notify, manual invoice, club-payment overdue → mail + degrade to free, usage overage never blocks), pending build |
| 32 | Associate fees (monthly / bimonthly / semestral / yearly) — club-level amount (nullable = off) + cadence, per-user per-period collected flag, overdue report, >7-day mail reminder behind a club admin toggle | SPEC'd 2026-10-01: `app_settings.fee_cents` nullable + `fee_cadence` (monthly|bimonthly|semestral|yearly, calendar-anchored) + `users.fee_exempt` + `fee_payments(user,period_start,collected_at,by)` + `notify_fee_overdue` club toggle (default on); associates owe, admins never; amount per period in club currency, no prorating; admin marks collected per user/period in dedicated `admin-fees` view; reminder mail once per period at >7 days overdue; optional `fee_block_booking` (default off) hard-blocks booking/joining after the same 7-day grace; all plans, audited, building |
| 33 | Medical certificate requirement — club toggle; cert valid 1 year from emission; admin uploads scan + expiry per player; missing/expired cert blocks booking AND joining; expiry reminder mail to player + admin 1 month ahead | Building on `feat/med-cert`: `app_settings.require_medical_cert` + `users.medical_cert_{expires_at,scan,mime,verified_by,verified_at}` + set/remove/download endpoints + gates (`medical_cert_required/expired`, admins bypass) + daily 07:30 reminder (player + admins, once per expiry) + params toggle + user-panel upload + list badges |
| 34 | Club booking policy — admin-defined cancellation rules + payment mode (upfront online vs pay on court) | SPEC'd 2026-10-01 (`SPEC.md` §4.4): free cancel until `min_cancel_hours`, no self-cancel after deadline, admin `no-show` marking (report-only); `booking_payment_mode` on_court default, upfront only when online payments live (#16, Go/Pro); `bookings.payment_status` unpaid\|paid\|onsite, pending build |
| 35 | Booking manager role — staff that can only approve/reject bookings | Admin assigns `manager`; queue + approve/reject only, everything else 403; managers never owe fees; no mod notifications (admins still pinged) |
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
- #23 notifications v2 (policy × subscription × reachability; push master + WA/TG channels; Notify-users vs Admin-alerts tabs)
- #26 explicit participant lists (per-club `require_participant_list`, member search, confirm/edit picker)
- #30 feature requests (shared anonymized board + `+1` votes, tracked statuses + reply; club + platform UI)

## Rules

- Lines starting with `feat:` are logged here, never built immediately.
- New feature requests land here first (top table) before any design doc grows.
- Tests are incremental: every feature ships with its vitest coverage, no big-bang test phase.
- `MULTITENANT.md` stays a design doc for features 5–15, not the list itself.
- Club features ship as per-club toggles with safe defaults, never global mandates.
