import { z } from "zod";

export const preferredLanguageSchema = z.enum(["it", "en", "fr", "de", "es"]);
// Full international number, digits only, no "+" (E.164 without prefix, e.g. 393331234567).
// Frontend always sends countryCode + national number combined via fullMobile().
export const mobileSchema = z.string().regex(/^\d{6,20}$/);
// Email optional variant (admin create has no required email input in the UI).
export const optionalEmailSchema = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().email().toLowerCase().nullable().optional());
export const registerSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_.-]+$/),
  email: z.string().email().toLowerCase(),
  mobile: mobileSchema,
  password: z.string().min(8).max(128),
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  preferred_language: preferredLanguageSchema.optional().default("it"),
  club_slug: z.string().min(3).max(50).regex(/^[a-z0-9-]+$/).optional(),
});
// Admin create has no required email/phone inputs in the UI — both stay optional there.
export const adminCreateUserSchema = registerSchema.omit({ mobile: true, email: true }).extend({ mobile: mobileSchema.optional(), email: optionalEmailSchema });

export const loginSchema = z.object({
  username: z.string().optional(),
  email: z.string().email().optional(),
  password: z.string().min(1),
  club_slug: z.string().min(3).max(50).regex(/^[a-z0-9-]+$/).optional(),
}).refine((d) => d.username || d.email, { message: "username or email required" });

export const courtSchema = z.object({
  number: z.number().int().positive(),
  type: z.enum(["tennis", "padel"]),
  name: z.string().max(100).optional().nullable(),
  surface: z.string().max(50).optional().nullable(),
  base_price_cents: z.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
});

export const timetableEntrySchema = z.object({
  court_id: z.string().uuid().nullable().optional(),
  day_of_week: z.number().int().min(0).max(6),
  open_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
  close_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
  slot_duration_minutes: z.number().int().refine((v) => [30, 60, 90, 120].includes(v)).optional(),
  is_closed: z.boolean().optional(),
});

export const timetableBulkSchema = z.array(timetableEntrySchema);

export const bookingIntentSchema = z.object({
  court_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  notes: z.string().max(1000).optional().nullable(),
  rent_racquets: z.number().int().min(0).max(4).optional().default(0),
  players: z.union([z.literal(2), z.literal(4)]).optional(),
});

export const blockSchema = z.object({
  court_id: z.string().uuid().nullable().optional(),
  start_at: z.string().datetime(),
  end_at: z.string().datetime(),
  reason: z.string().min(1).max(500),
});

export const blockingRuleSchema = z.object({
  court_id: z.string().uuid().nullable().optional(),
  day_of_week: z.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  reason: z.string().min(1).max(500),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  is_active: z.boolean().optional(),
});

export const profileSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_.-]+$/).optional(),
  email: z.preprocess((v) => (v === "" ? null : v), z.string().email().nullable().optional()),
  preferred_language: preferredLanguageSchema.optional(),
  preferred_sport: z.enum(["tennis", "padel"]).optional().nullable(),
  mobile: z.string().max(20).optional().nullable(),
  telegram_chat_id: z.string().max(100).optional().nullable(),
  gender: z.enum(["male", "female", "other", "prefer_not_to_say"]).optional().nullable(),
  birthdate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
});

export const settingsSchema = z.object({
  default_slot_duration_minutes: z.number().int().refine((v) => [30, 60, 90, 120].includes(v)).optional(),
  booking_hold_minutes: z.number().int().min(5).max(120).optional(),
  max_advance_days: z.number().int().min(1).max(90).optional(),
  min_cancel_hours: z.number().int().min(0).max(48).optional(),
  auto_approve_bookings: z.boolean().optional(),
  club_name: z.string().max(100).optional().nullable(),
  club_phone: z.string().max(30).optional().nullable(),
  club_address: z.string().max(200).optional().nullable(),
  notifications_enabled: z.boolean().optional(),
  notify_on_auto_approved: z.boolean().optional(),
  notify_on_approval: z.boolean().optional(),
  notify_on_rejection: z.boolean().optional(),
  notify_via_telegram: z.boolean().optional(),
  notify_via_whatsapp: z.boolean().optional(),
  telegram_bot_token: z.string().max(500).optional().nullable(),
  telegram_admin_chat_id: z.string().max(255).optional().nullable(),
  whatsapp_token: z.string().max(2000).optional().nullable(),
  whatsapp_phone_number_id: z.string().max(50).optional().nullable(),
  whatsapp_admin_phone: z.string().max(30).optional().nullable(),
  enabled_locales: z.array(preferredLanguageSchema).min(1).max(5).optional(),
  default_locale: preferredLanguageSchema.optional(),
});

const announcementTranslationEntry = z.object({
  title: z.string().max(200),
  body: z.string().max(5000),
});
const announcementBase = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  visibility: z.enum(["public", "members"]).optional().default("public"),
  publish_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  publish_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  translations: z.record(preferredLanguageSchema, announcementTranslationEntry).optional(),
});
export const announcementSchema = announcementBase.refine((d) => !d.publish_start || !d.publish_end || d.publish_end >= d.publish_start, {
  message: "publish_end before publish_start",
});
export const announcementPatchSchema = announcementBase.partial();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
