import { pgTable, uuid, text, varchar, integer, smallint, boolean, timestamp, date, time, pgEnum, index, unique, char } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const userRoleEnum = pgEnum("user_role", ["associate", "admin", "superadmin"]);
export const courtTypeEnum = pgEnum("court_type", ["tennis", "padel"]);
export const bookingStatusEnum = pgEnum("booking_status", [
  "pending_registration",
  "pending_approval",
  "approved",
  "rejected",
  "cancelled",
  "expired",
]);
export const preferredLanguageEnum = pgEnum("preferred_language", ["it", "en", "fr", "de", "es"]);
export const genderEnum = pgEnum("gender", ["male", "female", "other", "prefer_not_to_say"]);
export const announcementVisibilityEnum = pgEnum("announcement_visibility", ["public", "members"]);
export const clubPlanEnum = pgEnum("club_plan", ["free", "starter", "pro"]);

export const clubs = pgTable("clubs", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: varchar("slug", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  timezone: varchar("timezone", { length: 50 }).notNull(),
  plan: clubPlanEnum("plan").notNull().default("starter"),
  currency: char("currency", { length: 3 }).notNull().default("EUR"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  maxCourts: integer("max_courts"),
  isDemo: boolean("is_demo").notNull().default(false),
  demoExpiresAt: timestamp("demo_expires_at", { withTimezone: true }),
  isListed: boolean("is_listed").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable only for the platform superadmin (outside all clubs).
    // Every club role (associate/admin) always carries a club_id.
    clubId: uuid("club_id").references(() => clubs.id),
    username: varchar("username", { length: 30 }).notNull(),
    email: varchar("email", { length: 255 }),
    passwordHash: text("password_hash").notNull(),
    firstName: varchar("first_name", { length: 100 }).notNull(),
    lastName: varchar("last_name", { length: 100 }).notNull(),
    role: userRoleEnum("role").notNull().default("associate"),
    preferredLanguage: preferredLanguageEnum("preferred_language").notNull().default("it"),
    preferredSport: courtTypeEnum("preferred_sport"),
    mobile: varchar("mobile", { length: 20 }),
    telegramChatId: varchar("telegram_chat_id", { length: 100 }),
    notifyEmail: boolean("notify_email").notNull().default(true),
    notifyPushMaster: boolean("notify_push_master").notNull().default(true),
    notifyWhatsapp: boolean("notify_whatsapp").notNull().default(true),
    notifyTelegram: boolean("notify_telegram").notNull().default(true),
    gender: genderEnum("gender"),
    birthdate: date("birthdate"),
    isVerified: boolean("is_verified").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references((): any => users.id),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("users_club_username_idx").on(t.clubId, t.username),
    index("users_club_email_idx").on(t.clubId, t.email),
  ]
);

export const courts = pgTable(
  "courts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    number: integer("number").notNull(),
    type: courtTypeEnum("type").notNull(),
    name: varchar("name", { length: 100 }),
    surface: varchar("surface", { length: 50 }),
    basePriceCents: integer("base_price_cents").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("courts_club_number_unique").on(t.clubId, t.number)]
);

export const timetables = pgTable(
  "timetables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courtId: uuid("court_id").references(() => courts.id, { onDelete: "cascade" }),
    dayOfWeek: smallint("day_of_week").notNull(),
    openTime: time("open_time"),
    closeTime: time("close_time"),
    slotDurationMinutes: integer("slot_duration_minutes").notNull().default(60),
    isClosed: boolean("is_closed").notNull().default(false),
  },
  (t) => [unique("timetables_court_day_unique").on(t.courtId, t.dayOfWeek)]
);

// Flexible slot grids (#24): ordered open windows per court × weekday.
// Closed day = zero windows. Legacy `timetables` kept read-only as fallback.
export const timetableWindows = pgTable(
  "timetable_windows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courtId: uuid("court_id")
      .notNull()
      .references(() => courts.id, { onDelete: "cascade" }),
    dayOfWeek: smallint("day_of_week").notNull(),
    openTime: time("open_time").notNull(),
    closeTime: time("close_time").notNull(),
    slotDurationMinutes: integer("slot_duration_minutes").notNull().default(60),
    priceCents: integer("price_cents"),
    position: integer("position").notNull().default(0),
  },
  (t) => [unique("timetable_windows_court_day_pos_unique").on(t.courtId, t.dayOfWeek, t.position)]
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    courtId: uuid("court_id")
      .notNull()
      .references(() => courts.id),
    userId: uuid("user_id").references(() => users.id),
    date: date("date").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    status: bookingStatusEnum("status").notNull(),
    notes: text("notes"),
    rentRacquets: integer("rent_racquets").notNull().default(0),
    players: integer("players").notNull().default(2),
    priceCents: integer("price_cents").notNull().default(0),
    guestToken: varchar("guest_token", { length: 64 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("bookings_court_date_idx").on(t.courtId, t.date),
    index("bookings_status_idx").on(t.status),
    index("bookings_guest_token_idx").on(t.guestToken),
  ]
);

export const blocks = pgTable(
  "blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    courtId: uuid("court_id").references(() => courts.id, { onDelete: "cascade" }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("blocks_start_end_idx").on(t.startAt, t.endAt)]
);

export const blockingRules = pgTable("blocking_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  clubId: uuid("club_id")
    .notNull()
    .references(() => clubs.id),
  courtId: uuid("court_id").references(() => courts.id, { onDelete: "cascade" }),
  dayOfWeek: smallint("day_of_week").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  reason: text("reason").notNull(),
  validFrom: date("valid_from"),
  validUntil: date("valid_until"),
  isActive: boolean("is_active").notNull().default(true),
});

export const appSettings = pgTable("app_settings", {
  clubId: uuid("club_id")
    .primaryKey()
    .references(() => clubs.id, { onDelete: "cascade" }),
  defaultSlotDurationMinutes: integer("default_slot_duration_minutes").notNull().default(60),
  bookingHoldMinutes: integer("booking_hold_minutes").notNull().default(30),
  maxAdvanceDays: integer("max_advance_days").notNull().default(14),
  minCancelHours: integer("min_cancel_hours").notNull().default(2),
  autoApproveBookings: boolean("auto_approve_bookings").notNull().default(false),
  clubName: varchar("club_name", { length: 100 }),
  clubPhone: varchar("club_phone", { length: 30 }),
  clubAddress: varchar("club_address", { length: 200 }),
  notifyEmailSender: text("notify_email_sender"),
  telegramBotToken: text("telegram_bot_token"),
  telegramAdminChatId: varchar("telegram_admin_chat_id", { length: 255 }),
  whatsappToken: text("whatsapp_token"),
  whatsappPhoneNumberId: varchar("whatsapp_phone_number_id", { length: 50 }),
  whatsappAdminPhone: varchar("whatsapp_admin_phone", { length: 30 }),
  enabledLocales: text("enabled_locales").array().notNull().default(sql`ARRAY['it','en','fr','de','es']`),
  defaultLocale: varchar("default_locale", { length: 5 }).notNull().default("it"),
  twoFaEnabled: boolean("two_fa_enabled").notNull().default(false),
  flexibleSlots: boolean("flexible_slots").notNull().default(false),
  showPrices: boolean("show_prices").notNull().default(true),
  allowOpenSignup: boolean("allow_open_signup").notNull().default(true),
  requireParticipantList: boolean("require_participant_list").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  clubId: uuid("club_id").references(() => clubs.id),
  actorId: uuid("actor_id").references(() => users.id),
  action: varchar("action", { length: 50 }).notNull(),
  target: varchar("target", { length: 100 }).notNull(),
  meta: text("meta"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const announcements = pgTable("announcements", {
  id: uuid("id").primaryKey().defaultRandom(),
  clubId: uuid("club_id")
    .notNull()
    .references(() => clubs.id),
  title: varchar("title", { length: 200 }).notNull(),
  body: text("body").notNull(),
  visibility: announcementVisibilityEnum("visibility").notNull().default("public"),
  position: integer("position").notNull().default(0),
  publishStart: date("publish_start"),
  publishEnd: date("publish_end"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const announcementTranslations = pgTable("announcement_translations", {
  announcementId: uuid("announcement_id").notNull().references(() => announcements.id, { onDelete: "cascade" }),
  lang: varchar("lang", { length: 5 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  body: text("body").notNull(),
});

export const telegramLinkTokens = pgTable("telegram_link_tokens", {
  token: varchar("token", { length: 64 }).primaryKey(),
  clubId: uuid("club_id")
    .notNull()
    .references(() => clubs.id),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Platform settings (superadmin-maintained, e.g. base_url). No RLS, no club.
export const platformSettings = pgTable("platform_settings", {
  key: varchar("key", { length: 50 }).primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Notifications v2 (#23): per-club per-event policy (admin side).
// Events: request (→admins), auto (→admins + user), approval/rejection (→user).
export const notifyPolicy = pgTable(
  "notify_policy",
  {
    clubId: uuid("club_id").notNull().references(() => clubs.id, { onDelete: "cascade" }),
    event: varchar("event", { length: 20 }).notNull(),
    toUsersEmail: boolean("to_users_email").notNull().default(true),
    toUsersPush: boolean("to_users_push").notNull().default(true),
    toAdminsEmail: boolean("to_admins_email").notNull().default(true),
    toAdminsPush: boolean("to_admins_push").notNull().default(true),
  },
  (t) => [
    index("notify_policy_club_idx").on(t.clubId),
  ]
);

// Notifications v2 (#23): per-user per-event push prefs (opt-out; absent = on).
// Email is mandatory — no email prefs. club_id denormalized for RLS.
export const notifyEventPrefs = pgTable(
  "notify_event_prefs",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    clubId: uuid("club_id").notNull().references(() => clubs.id, { onDelete: "cascade" }),
    event: varchar("event", { length: 20 }).notNull(),
    push: boolean("push").notNull().default(true),
  },
  (t) => [
    index("notify_event_prefs_user_idx").on(t.userId),
  ]
);

// Participant lists (#26): explicit identities per booking (join table).
// club_id denormalized for RLS, like notify_event_prefs.
export const bookingParticipants = pgTable(
  "booking_participants",
  {
    bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
    clubId: uuid("club_id").notNull().references(() => clubs.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [
    index("booking_participants_booking_idx").on(t.bookingId),
  ]
);

// Impersonation grants: time-boxed superadmin-as-club-admin sessions.
// Checked in code (assertClubAccess); no RLS, like other platform tables.
export const impersonationGrants = pgTable("club_impersonation_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  clubId: uuid("club_id").notNull().references(() => clubs.id, { onDelete: "cascade" }),
  superadminId: uuid("superadmin_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Superadmin 2FA login challenges (Telegram OTP). Short-lived, single-use.
export const loginChallenges = pgTable("login_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  codeHash: varchar("code_hash", { length: 64 }).notNull(),
  purpose: varchar("purpose", { length: 20 }).notNull().default("login"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Abuse shield (#13): persistent IP blocks. Platform-only access via
// superadmin routes; never tenant data, so no RLS and no club_id.
export const ipBlocks = pgTable("ip_blocks", {
  ip: varchar("ip", { length: 64 }).primaryKey(),
  reason: varchar("reason", { length: 100 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
