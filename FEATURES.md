# Features — wider list (MVP flags)

> Index only. Multitenancy is one feature among many. Deep design lives in
> `SPEC.md` (single-club baseline) and `MULTITENANT.md` (multitenancy design).
> MVP = must-have for first multitenant release; non-MVP = deferred.

| # | Feature | MVP? | Status | Details |
|---|---------|:---:|--------|---------|
| 1 | Single-club booking (courts, timetable, availability, bookings, blocks) | ✅ | done | `SPEC.md` §§3–11 |
| 2 | Auth + roles (`visitor\|associate\|admin`, JWT 15m + refresh 7d) | ✅ | done | `SPEC.md` §8, `MEMORY.md` §5 |
| 3 | i18n 5 langs + theme centralisation | ✅ | done | `MEMORY.md` §§3–4 |
| 4 | Notifications (Telegram/WhatsApp, admin queue) | ✅ | done-ish | `SPEC.md` §4.4, `feat/notifications` |
| 5 | Multitenancy core (clubs table, `club_id` scoping, per-club settings/timezone) | ✅ | planned | `MULTITENANT.md` §§1–5, Phases 0–4 |
| 6 | Test coverage — after multitenancy core: catch up missing suites (#1–4), then incremental per feature (vitest, endpoint + cross-club) | ✅ | deferred until #5 done | `MULTITENANT.md` Phase 4 |
| 7 | Club slug — URI-compatible name + deep link (`/club/:slug/`) | ✅ | planned | `MULTITENANT.md` §6 |
| 8 | Platform frontend (`/` landing + `/clubs` directory) | ✅ | planned | `MULTITENANT.md` §7, Phase 6 |
| 9 | Platform admin (`superadmin`, `/api/platform/*`, `/platform` UI) | ✅ | planned | `MULTITENANT.md` §9, Phase 7 |
| 10 | Platform pricing display (tiers on `/`, plan per club; billing manual) | ✅ | planned | `MULTITENANT.md` §8A |
| 11 | Court rental pricing display (per-court price, snapshot on booking, revenue reports) | ✅ | planned | `MULTITENANT.md` §8B |
| 12 | Demo tenant (public sandbox club, routine reset for prospect self-demo) | ✅ | planned | `MULTITENANT.md` §10 |
| 13 | Abuse shield (IP blacklist: login brute-force, DDoS patterns, URL-mangling probes; extends current rate limits) | ✅ | planned | `SPEC.md` §8 |
| 14 | Superadmin 2FA (Telegram OTP second step; secrets on Render) | ✅ | planned | `MULTITENANT.md` §9 |
| 15 | Per-club locales (enabled language list + default; single-locale clubs hide language UI and announcement translations) | ✅ | planned | `MULTITENANT.md` §11 |
| 16 | Online payment collection (Stripe/subscriptions/player checkout) | ❌ | deferred | was `SPEC.md:20` non-goal |
| 17 | Peak/off-peak price rules, discounts, memberships | ❌ | deferred | `MULTITENANT.md` §8B |
| 18 | Tournaments (brackets, scheduling, court assignment, entries) | ❌ | deferred | `SPEC.md` §§3.3, 12 Phase 3 |
| 19 | Player & team rankings (per-sport points, levels, leaderboards) | ❌ | deferred | `SPEC.md` §§3.3, 12 Phase 3 |
| 20 | Social login alt route (OAuth Google/Apple; identity still club-scoped, one user = one club) | ❌ | deferred | `SPEC.md` §8 |
| 21 | Calendar sync, native apps, realtime chat | ❌ | deferred | `SPEC.md:20` non-goals |
| 22 | Memberships join table (one login, many clubs) | ❌ | deferred | `MULTITENANT.md` §1 |
| 23 | Notifications per channel — email + push, push suboptions WhatsApp / Telegram; the mail, telegram and whatsapp settings sections are only visible when their channel checkbox is on | ✅ | planned (Massimo) | needs #28 first; per-club sender settings + channel toggles |
| 24 | Flexible slot definitions: (a) per-court × weekday precise slots, (b) constant durations day/week-wide (current), (c) midday break — morning/afternoon gap | ✅ | planned (Massimo) | per-club option; extends #1 timetable (day needs multiple open windows, not one open–close) |
| 25 | Admin-managed accounts (admin sets usernames, no open signup) | ✅ | planned (Massimo) | per-club option (`allow_open_signup` flag, default on?) |
| 26 | Explicit participant lists on bookings (admin bypass: free booking) | ✅ | planned (Massimo) | per-club option; extends #1 booking model |
| 27 | Password reset via email (token link, expiry, single-use) | ✅ | planned (Massimo) | cross-cutting, needed regardless of #23 content mail |
| 28 | Transactional email provider (REST API — Render blocks SMTP traffic) | ✅ | planned (Massimo) | blocks #23 + #27; candidates TBD (Resend/Brevo/Postmark-style) |

## Notes — Massimo (prospect, next release)
- #23–#26 are **per-club admin options**, never global mandates: each club toggles them in settings; defaults keep current behaviour.
- #24 must cover three shapes: (a) fully custom per-court × weekday slots, (b) today's constant-duration grid, (c) a midday break splitting morning/afternoon. Design implication: a day needs **multiple open windows**, not a single open–close pair.
- #27 is needed in any case (support + onboarding), independent of notification content.
- #28 is the infrastructure prerequisite: no SMTP on Render, so a REST-API mail provider must be chosen + sender identity per club.

## Rules
- New feature requests land here first with an MVP? flag before any design doc grows.
- Tests are incremental: every feature ships with its vitest coverage, no big-bang test phase.
- `MULTITENANT.md` stays a design doc for features 5–15, not the list itself.
