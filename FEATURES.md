# Features — wanted, done, out of scope

> Index only. Deep design lives in `SPEC.md` (single-club baseline) and
> `MULTITENANT.md` (multitenancy design).

## Wanted (not built yet)

| # | Feature | Notes |
|---|---------|-------|
| 31 | Usage-based tiers (metering + allowances + gates + soft billing) | SPEC'd 2026-10-01 (`MULTITENANT.md` §8-A2: monthly bookings+actives, 80/100% audit+notify, manual invoice, club-payment overdue → mail + degrade to free, usage overage never blocks), pending build |
| 32 | Associate fees (monthly / bimonthly / semestral / yearly) — club-level amount (nullable = off) + cadence, per-user per-period collected flag, overdue report, >7-day mail reminder behind a club admin toggle | SPEC'd 2026-10-01: `clubs.fee_cents` nullable + `clubs.fee_cadence` (monthly|bimonthly|semestral|yearly) + `fee_payments(user,period_start,collected_at,by)` + `notify_fee_overdue` club toggle (default on); admin marks collected per user/period; overdue = past period unpaid while fee set; report lists overdue; nightly job mails users >7 days overdue iff toggle on; soft by default with optional `fee_block_booking` club toggle (default off) that hard-blocks booking/joining while overdue, pending build |
| 33 | Medical certificate requirement — club toggle; cert valid 1 year from emission; admin uploads scan + expiry per player; missing/expired cert blocks booking AND joining; expiry reminder mail to player + admin 1 month ahead | SPEC'd 2026-10-01: `clubs.require_medical_cert` toggle (default off) + `user.medical_cert_{scan,expires_at,verified_by}`; booking create + participant-join paths reject with `medical_cert_required/expired` when toggle on; nightly job mails player + club admin at 30 days to expiry (once); unlike fees this gates booking by design, pending build |
| 34 | Club booking policy — admin-defined cancellation rules + payment mode (upfront online vs pay on court) | SPEC'd 2026-10-01 (`SPEC.md` §4.4): free cancel until `min_cancel_hours`, no self-cancel after deadline, admin `no-show` marking (report-only); `booking_payment_mode` on_court default, upfront only when online payments live (#16, Go/Pro); `bookings.payment_status` unpaid\|paid\|onsite, pending build |
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
