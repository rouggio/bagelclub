# Bagel Club — AI Session Memory

> Persisted habits and facts so next AI session doesn't lose track. Keep this file updated after each significant change.

## 1. Project & Stack
- **App**: Bagel Club (brand centralised: `frontend/src/brand.ts` `VITE_BRAND_NAME`, `backend/src/config/brand.ts` `BRAND_NAME`; `t('app.name')` returns it; formerly Empanadel) — tennis & padel court booking, mobile-first. Personas `associate|admin`. Deferred visitor flow `browse → select slot → register → confirm → pending_approval|approved`.
- **Frontend**: `HTML + Alpine.js (Aurora) + Vite + Tailwind 4`, `frontend/src/main.ts:12` `app()` Alpine store, `frontend/index.html:1` SPA, `frontend/vite.config.ts:1` proxy `/api → :3000`, `frontend/src/styles.css:1` `@import "tailwindcss"` + `:root` theme.
- **Backend**: `Node 20+ TS 5.x strict NodeNext ESM Fastify 4 Drizzle pg Zod bcryptjs @fastify/jwt/cookie/static/rate-limit/cors`, `backend/src/app.ts:1`, `backend/tsconfig.json:1` `ES2022 NodeNext strict`, `backend/drizzle.config.ts:1`.
- **DB**: PostgreSQL 16 `btree_gist` EXCLUDE, Neon pooled `postgresql://neondb_owner:npg_WqXumnT7sfr0@ep-orange-sea-b1tza1cy-pooler.c-5.eu-central-1.aws.neon.tech/neondb?sslmode=require`, local `docker-compose.yml:1` `postgres:16-alpine:5432` `postgres:postgres@localhost:5432/empanadel`. **Do NOT use `libsql://empanadel-empanadel.aws-eu-west-1.turso.io`** (wrong).
- **Schema**: `backend/src/db/schema.ts:1` 8 tables `users|courts|timetables|bookings|blocks|blockingRules|appSettings|auditLog` + enums `userRole| courtType| bookingStatus| preferredLanguage| gender`. `bookings.userId → users.id` **no cascade** (handled in code). `appSettings` now `clubName varchar100 | clubPhone varchar30 | clubAddress varchar200` (`0006_club_info.sql`).
- **Club Info**: `backend/src/types/schemas.ts:77` `settingsSchema` + `club_name/phone/address`, `backend/src/routes/settings.ts:7` `GET /api/club-info` public + `GET/PUT /api/settings` admin, `frontend/src/main.ts:45` `clubInfo/clubForm` + `loadClubInfo/loadAdminClubInfo/saveClubInfo`, `frontend/index.html` `view==='admin-club'` form + `Admin → Club` nav (desktop+mobile), footer `clubInfo ? club_name - tel. club_phone - address : t('footer')`.
- **Spec**: `SPEC.md:3` v0.1.0→v0.1.7+ (add via `neon.ts` etc.).

## 2. Git & Deploy — CRITICAL HABIT
- **Remote**: `origin git@github.com:rouggio/bagelclub.git` (renamed from `rouggio/empanadel` 2026-09-26) `push.autoSetupRemote=true` branch `main`.
- **Commits**: inspect `git status`, `git diff`, `git log --oneline -10` before committing; stage only intended files; never commit secrets; concise commit message matching repo style.
- **NEVER push to production (origin/main) nor trigger Render deploy unless explicitly requested by user** — keep all work on feature branches (`feat/*`) and local commits; only after user says `push`, `merge to main and push to render`, `deploy`, or shorthand `pd` (= push+deploy) you may `git push` + `POST https://api.render.com/deploy/srv-darnrld9fdbs73ac0u3g?key=QXQBgUZ55kQ` (old hook `srv-daqe6t17lnhs73cmjon0` died when Render was reconfigured 2026-09-26). All recent fixes (`93cdfcf` etc.) were pushed before this rule; from now on hold back.
- **All bugs & actions requested are for LOCAL dev (`docker-compose` postgres:5432, `localhost:3000/5173`) unless user explicitly says `production`/`live`/`Neon`/`Render`** — do not touch production DB or `origin/main` for fixes like `20:00 booking 409` `Centrale` local `diag.mjs` etc.
- **When deploy IS requested**: Render `autoDeploy` is **OFF**. After `git push` you **MUST** call the deploy hook:
  ```
  POST https://api.render.com/deploy/srv-darnrld9fdbs73ac0u3g?key=QXQBgUZ55kQ
  ```
  Returns `200`/`202` when triggered. Check `https://dashboard.render.com` → `empanadel-api` → `Deploys` for `live`. `RENDER_API_KEY=rnd_NjNDJCirx2Syaifem7XBALC4LvMJ` is for workspace `IndietroTutta` (`srv-d9cho6uq...`) and **cannot** see Empanadel service — do not use `GET /v1/services` with it for Empanadel.
- **Render Blueprint**: `render.yaml:1` single `empanadel-api` `buildCommand: NPM_CONFIG_PRODUCTION=false npm ci --prefix backend && npm run build --prefix backend && NPM_CONFIG_PRODUCTION=false npm ci --prefix frontend && npm run build --prefix frontend` `startCommand: npm run migrate && npm start` `health /health` + `empanadel-db` frankfurt. Env `DATABASE_URL` must be Neon `postgres://...`, `JWT_SECRET`, `JWT_EXPIRES_IN=15m`, `CORS_ORIGIN=http://localhost:5173`, `CLUB_TIMEZONE=Europe/Rome`.
- **Local Dev**: `package.json:6` `npm run dev` → `concurrently` `api: npm run dev --prefix backend` (`tsx watch` port `3000`) + `web: npm run dev --prefix frontend` (Vite `5173`). **After backend changes** `tsx watch` should hot-reload but often needs `taskkill /F /IM node.exe` + `npm run dev`; **after frontend changes** Vite HMR works but browser needs `Ctrl+F5` hard refresh. Check `Get-NetTCPConnection -LocalPort 3000,5173` and `Invoke-WebRequest http://localhost:3000/health` / `http://localhost:5173`.

## 3. Theme Centralisation — HABIT
- **Single source**: `frontend/src/styles.css:7` `:root` vars — edit only there:
  - Page `--color-page-bg #fafafa`, surface `--color-surface #fff`, header/footer `--color-header-bg rgba(236,253,245,0.8)` `emerald-50/80` (intentionally lighter than buttons), buttons `--color-btn-primary-bg #a7f3d0` `emerald-200` + `border #6ee7b7` + `text #064e3b`, slots `available emerald-50/200`, `booked/blocked/lesson` `bg-red-50 text-red-700 border-red-200` (lighter red), `pending amber-100/300`, `isPastSlot` grey `bg-zinc-100`, inputs `--color-input-bg #dcfce7` `green-100` + autofill override `-webkit-autofill` `box-shadow inset`.
  - Semantic helpers `.site-header/.site-footer/.site-page/.btn-primary/.btn-light/.hero-gradient` + `input:not([type=radio]):not([type=checkbox]), textarea, select` rule.
- **Buttons**: all squared `rounded-lg` (not `rounded-full`), primary = `emerald-200` light green (changed from `black`/`emerald-600`). Header language button `px-4 py-2 text-sm` same size as login.
- **Never** use hard-coded `bg-white/80` or `bg-black` for primary actions — use vars.

## 4. i18n — HABIT
- **5 langs** `it|en|fr|de|es` (`users.preferred_language` enum default `it`, `preferred_sport tennis|padel nullable`, `mobile varchar20`, `gender male|female|other|prefer_not_to_say`, `birthdate date`), `frontend/src/i18n/*.json` ~160 keys + `flagcdn.com/w20` + `frontend/src/i18n/index.ts:58` `t(key)`.
- **Rule**: every user-visible string must be `x-text="t('key')"` or `:placeholder="t('key')"`; when adding a new label, add key to **all 5** `it|en|fr|de|es` files (keep Italian verbatim if user says "in all languages"). **No hardcoded English/French/etc. in `frontend/index.html` or `frontend/src/main.ts`** — use `t()` even for placeholders, hints, Telegram/Notifications/Admin.club. Weekdays `weekday.mon` etc. now full `Lunedì/Monday/...` (not `Mon`). `common.optional` → `facoltativo/optional/facultatif...`, `profile.preferredSport.none` → `-- tutti gli sport -- / -- all sports --` etc.
- **Recent**: `common.optional`, `telegram.*` (`title/connected/notConnected/connect/linking/disconnect/hint`), `admin.notifications.*` (29 keys incl. `admin.notifications.nav`, `admin.club.publicUrlPlaceholder/Hint`) localised `9561dc2`.
- **Validation**: `field.*`, `validation.*`, `error.taken/registerFailed/loginFailed`, `btn.*`, `admin.*`, `status.unavailable` etc.

## 5. Auth & Users
- JWT `15m` + refresh `7d httpOnly cookie`, `bcrypt 10`, `JwtPayload {id,username,role,preferred_language}`, RBAC `associate|admin`, seeds `admin/admin123!` + `rouggio/rouggio123!` (`$2a$10$97IO...`), `backend/src/plugins/auth.ts:1` `authenticate/requireRole`.
- **Last admin guard**: `backend/src/routes/users.ts:141` `DELETE` and `PATCH` check admin count `<=1` → `400 Cannot delete/demote last admin`; frontend `frontend/index.html:367` disable delete `opacity-40 cursor-not-allowed` + `title t('admin.users.lastAdmin')`.
- **Cascade delete**: `DELETE /api/users/:id` first `delete bookings where userId=id` + `update bookings set reviewedBy=null` + `blocks.createdBy=null` + `auditLog.actorId=null` to avoid `23503 FK`.

## 6. Booking & Availability — HABITS
- **Deferred**: no DB hold for anonymous; `pending_booking_intent` in `localStorage` → `POST /api/bookings {court_id,date,start_time,notes?,rent_racquets?0-4,players?2|4}` via `frontend/src/main.ts:231` `register()` + `307` `login()`; `status approved` if `admin` or `auto_approve_bookings` else `pending_approval`; `409` overlap.
- **Past guard**: `backend/src/routes/bookings.ts:22` `todayStr = toLocaleDateString('en-CA', {timeZone: CLUB_TIMEZONE})` + `nowTime` check → `400 Cannot book in past`; frontend `frontend/src/main.ts:138` `isPastSlot()` + `frontend/index.html:85` `:min` + `:disabled="isPastSlot(slot) || ..."` + grey `isPastSlot` class.
- **Timetable**: per-court `slot_duration_minutes 30|60|90|120` (padel `90`, tennis `60`, fallback `app_settings.default_slot_duration`), `backend/src/routes/availability.ts:62` `baseSlots = splitIntoSlots(open,close,duration)` + `expand blocks (ad-hoc grey→red + recurring blockingRules brown→red) + bookings`.
- **Slot colours**: `available emerald-50/200`, `booked/blocked/lesson` `red-50/200` (lesson was brown `amber-900` → now red), `pending amber-100/300`, `isPast grey`. Mine highlight: `bookingUserId===user.id` → `border-2 !border-red-700 ring-1 ring-red-700 font-bold` + `★ ` prefix + `bookingUsername` in `[username]` for admin (availability returns `bookingUsername`, bookings returns `username`).
- **Blocked label**: `backend/src/routes/availability.ts:68` `blocked` now includes `label: bl.reason`; frontend `frontend/index.html:114` `slot.status==='blocked' ? `${t('status.unavailable')}: ${slot.label}` ` and `lesson` same (`non disponibile: xxx` in `it`).

## 7. Courts
- Display name first: `frontend/src/main.ts:391` `courtLabel()` `${c.name || Court ${number}}·type`, `175` `pendingIntent courtLabel`, `frontend/index.html:103,323,481,505,90` all `court.name || #number` primary, `type` + `#number` secondary. Never show `Court X` if `name` exists (e.g. `Centrale` not `Court 1`).

## 8. Admin UX — HABITS
- **Separate screens**: `view==='admin-courts|timetable|users|create-user|view-user|bookings|blocks|club|reports|notifications'` (not single `admin`), `frontend/src/main.ts:115` hash handling + `viewedUserBack` for back from `admin-view-user` to caller (`bookings` or `users` via `viewUser`/`viewUserById`/`backFromViewUser()`).
- **Club screen**: `admin-club` (`admin.club.title` etc. in 5 langs) — `Admin → Club` (top nav dropdown mobile) with `clubForm` 4 inputs (`club_name/phone/address/public_url`) + `saveClubInfo()` → `PUT /api/settings`.
- **Timetable screen**: `admin-timetable` dedicated per-court `GET /api/timetable?court_id` + `PUT /api/timetable` bulk 7 days, `frontend/src/main.ts:62` `adminTimetableCourtId/Rows` + `loadAdminTimetable/saveAdminTimetable/openAdminTimetable`, `frontend/index.html:340` `Timetable` button per court + selector + 7-row table `weekday` `open/close/duration/closed` `3bf12ee` local only.
- **Nav**: desktop `hidden md:flex` with 5-6 admin links (`courts/timetable/users/bookings/blocks/club/reports/notifications`), mobile `md:hidden` dropdown top (`adminMobileOpen`) same; bottom `nav` `fixed` now only `Courts/MyBookings/Profile` (removed admin 4 Links to avoid overlap).
- **Courts CRUD**: `adminCourts` list shows `name || #number`, `type`, `surface`, `active`; `adminCourtForm` + `editingCourtId`.
- **Users**: `adminUsers` clickable `viewUser(u)` → read-only `admin-view-user` (disabled inputs `bg-zinc-100`), `username` in bookings links via `viewUserById(userId)` (fetches `/api/users` if not in `adminUsers`).
- **Blocks**: recurring `blockingRules` + ad-hoc `blocks` on same `admin-blocks` screen: `adminLessons` + `adminBlocks`, each with `Add`/`Update`/`Cancel` + per-row `Edit`/`Clone`/`Disable|Enable`/`Delete`, `editingLessonId`/`editingBlockId`, `PATCH /api/blocks/:id` and `PATCH /api/blocking-rules/:id` (`court_id` now handled).
- **My Bookings**: `view==='me'` `bookingsTab upcoming/past/all` + `bookingsPastRange month/3months/6months` `t('myBookings.lastMonth...')` filter `past` + `all` via `cutoffFor()`, no `Refresh` button, `Edit` + `Cancel` kept, rent line localised, `sort desc` most recent on top `sort((a,b)=>b.date.localeCompare(a.date))`, no `b.id.slice` hash.
- **Profile**: `mobile/telegram (Connect via t.me/... auto-link, hidden chat_id) /gender/birthdate/preferred_sport/ preferredLanguage` etc., `t('profile.updated')` etc. `telegram.*` localised, `common.optional` for `email`.

## 9. Validation & Errors — HABIT
- Backend Zod `flatten()` yields `{fieldErrors, formErrors}`; frontend `frontend/src/main.ts:231` `register()` and `307` `login()` map `fieldErrors` → `t('field.*') + t('validation.*')` bullet list `• ` + `\n` with `whitespace-pre-line` `frontend/index.html:167,198` `div` `border-red-200 bg-red-50`, `409` `error.taken` localised.

## 10. Tooling & Verification — HABITS
- Prefer specialized tools: `read` over `cat`, `edit/write` over `sed`, `glob/grep` over `ls/grep`, `bash` only for terminal ops (`git`, `npm`, `docker`, `python3 -c`).
- Verify via execution: `npm run build --prefix backend` (`tsc`), `npm run build --prefix frontend` (`vite build 25-26kB css 109-115kB js`), `docker ps`, `npm run migrate/seed`, `curl http://localhost:3000/health` etc.; never guess URLs.
- Root `npm run build` = backend ci + tsc + frontend ci (with dev) + frontend vitest + vite. Backend suite needs PG (`empanadel_test`), runs locally only — never in build. npm quirk: global `~/.npmrc allow-scripts` breaks chained `npm ci --prefix` (EALLOWSCRIPTS, local only); verify composed builds with `NPM_CONFIG_USERCONFIG=NUL`. Render unaffected.
- File ops: use `C:\Users\dario\AppData\Local\Temp\opencode` for temp, `workdir` param instead of `cd`.
- `frontend/index.html.test` exists (`Test-Path True`) — test fixture, keep.
- Untacked ` .agents/ .claude/ frontend/index.html.test skills-lock.json` — ignore unless needed.

## 11. Current State (as of 2026-09-25)
- Branches `main` commits `4c907fe` → `b278baa` (theme/i18n/admin) → `7e54b01` (court name) → `73faec3` (past guard etc.) → `b0701ef` (mobile dropdown etc.) → latest includes past guard, blocked red, spot blocks, weekdays full, court name, etc. Next deploy is `b0701ef`/`73faec3` after manual hook.
- Dev ports `3000` (Fastify) + `5173` (Vite) via `concurrently`; after push `git push` → manual `POST https://api.render.com/deploy/srv-darnrld9fdbs73ac0u3g?key=QXQBgUZ55kQ`.
- No `pending_registration` filter anymore in admin-bookings, no home `pendingIntent` amber block, no `Lingua` label, no hash IDs, no front page 3 cards.

Keep this file in sync — next AI should read it first.
