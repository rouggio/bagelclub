import Alpine from "alpinejs";
import { detectLang, setLang, t as translate, type Lang } from "./i18n/index.js";
import { DIAL_CODES, DIAL_CODE_BY_REGION } from "./dialCodes.js";
import {
  clubSlugFromPath, initClubSlug, getClubSlug, setClubSlug,
  storedToken, storeToken, clearToken, storedIntent, storeIntent, clearIntent,
  apiFetch, isPlatformPath, platformFetch, storeTokenFor, clearTokenFor, decodeToken,
} from "./clubContext.js";

try { initClubSlug(location.pathname); } catch {}

// Default country dial code from browser locale (fr-CH → +41), else app
// language (it → +39 …), else +39 (club is Italian). Full list in dialCodes.ts.
function defaultDialCode(): string {
  try {
    const tag = navigator.language || "";
    const parts = tag.split("-");
    const region = (parts[1] || "").toUpperCase()
      || ({ it: "IT", fr: "FR", de: "DE", es: "ES", en: "GB" } as Record<string, string>)[parts[0].toLowerCase()]
      || "";
    if (region && DIAL_CODE_BY_REGION[region]) return DIAL_CODE_BY_REGION[region];
  } catch {}
  return "+39";
}

declare global {
  interface Window {
    Alpine: typeof Alpine;
  }
}

type Court = { id: string; number: number; type: "tennis" | "padel"; name?: string; surface?: string; is_active: boolean };

function app() {
  return {
    view: "home" as string,
    lang: "it" as Lang,
    user: null as null | { id: string; username: string; role: string; preferred_language?: Lang },
    filterType: "" as string,
    selectedDate: new Date().toISOString().slice(0, 10),
    courts: [] as Court[],
    availability: {} as Record<string, Array<{ start: string; end: string; status: string }>>,
    pendingIntent: null as null | { courtId: string; date: string; startTime: string; courtLabel?: string; courtType?: string; notes?: string; rentRacquets?: number; players?: number },
    confirmLoading: false as boolean,
    confirmNotes: "" as string,
    confirmRent: 0 as number,
    confirmPlayers: "single" as "single" | "double",
    holdCountdown: null as string | null,
    _holdTimer: null as number | null,
    _refreshTimer: null as number | null,
    _refreshing: false as boolean,
    authForm: { username: "", password: "" },
    loginChallenge: null as null | { challenge_id: string; expires_at: string },
    loginCode: "" as string,
    twoFa: { pendingAction: "" as "" | "enable" | "disable", code: "" as string, msg: "" as string },
    regForm: { username: "", email: "", mobile_code: defaultDialCode(), mobile_number: "", first_name: "", last_name: "", password: "" },
    countryCodes: DIAL_CODES,
    authError: "" as string,
    bookings: [] as Array<{ id: string; courtId: string; court_id?: string; date: string; startTime: string; start_time?: string; endTime: string; end_time?: string; status: string; notes?: string; rentRacquets?: number; players?: number; priceCents?: number; courtNumber?: number; courtType?: string; courtName?: string }>,
    bookingsTab: "upcoming" as "upcoming" | "past" | "all",
    bookingsPastRange: "month" as "month" | "3months" | "6months",
    bookingsLoading: false as boolean,
    bookingsError: "" as string,
    adminBookings: [] as Array<{ id: string; courtId: string; date: string; startTime: string; endTime: string; status: string; userId?: string; username?: string; notes?: string; rentRacquets?: number; players?: number; priceCents?: number }>,
    adminUsers: [] as any[],
    adminUsersLoading: false as boolean,
    adminUsersError: "" as string,
    adminUsersSearch: "" as string,
    adminUsersRole: "" as string,
    viewedUser: null as any | null,
    viewedUserBack: "admin-users" as string,
    adminLoading: false as boolean,
    adminError: "" as string,
    adminFilter: "pending_approval" as string,
    adminDateFilter: "all" as "all" | "today" | "week" | "month" | "custom",
    adminDateFrom: "" as string,
    adminDateTo: "" as string,
    adminPage: 1 as number,
    adminPageSize: 10 as number,
    adminHighlightId: null as string | null,
    adminSettings: null as null | { auto_approve_bookings: boolean; booking_hold_minutes: number; two_fa_enabled?: boolean; notifications_enabled?: boolean; notify_on_auto_approved?: boolean; notify_on_approval?: boolean; notify_on_rejection?: boolean; notify_via_telegram?: boolean; notify_via_whatsapp?: boolean; telegram_bot_token?: string | null; telegram_bot_token_present?: boolean; telegram_admin_chat_id?: string | null; whatsapp_token_present?: boolean; whatsapp_phone_number_id?: string | null; whatsapp_admin_phone?: string | null },
    notificationForm: { notifications_enabled: false, notify_on_auto_approved: false, notify_on_approval: true, notify_on_rejection: true, notify_via_telegram: true, notify_via_whatsapp: true, telegram_bot_token: "", telegram_admin_chat_id: "", whatsapp_token: "", whatsapp_phone_number_id: "", whatsapp_admin_phone: "" } as { notifications_enabled: boolean; notify_on_auto_approved: boolean; notify_on_approval: boolean; notify_on_rejection: boolean; notify_via_telegram: boolean; notify_via_whatsapp: boolean; telegram_bot_token: string; telegram_admin_chat_id: string; whatsapp_token: string; whatsapp_phone_number_id: string; whatsapp_admin_phone: string },
    notificationTestResult: "" as string,
    reportsPeriod: "weekly" as "weekly" | "monthly" | "yearly",
    reportsDate: new Date().toISOString().slice(0, 10) as string,
    reportsLoading: false as boolean,
    reportsError: "" as string,
    reportsData: null as null | { period: string; refDate: string; startDate: string; endDate: string; overall: number; byUser: Array<{ userId: string; username: string; count: number }>; cancellationsByUser: Array<{ userId: string; username: string; count: number }>; timeline: Array<{ label: string; startDate: string; endDate: string; count: number }> },
    reportsSliceData: null as null | { period: string; startDate: string; endDate: string; overall: number; byUser: Array<{ userId: string; username: string; count: number }>; cancellationsByUser: Array<{ userId: string; username: string; count: number }> },
    reportsSelectedLabel: "" as string,
    clubInfo: null as null | { club_name: string; club_phone: string; club_address: string; slug?: string; timezone?: string; locales?: string[]; default_locale?: string },
    clubSlug: "" as string,
    clubTimezone: "Europe/Rome" as string,
    clubLocales: [] as string[],
    clubDefaultLocale: "it" as string,
    clubsList: [] as Array<{ slug: string; name: string }>,
    clubsLoading: false as boolean,
    clubCurrency: "EUR" as string,
    // Platform (superadmin) area — separate auth, no club scope.
    isPlatform: false as boolean,
    platformUser: null as null | { id: string; username: string; role: string },
    platformForm: { username: "", password: "" } as { username: string; password: string },
    platformChallenge: null as null | { challenge_id: string; expires_at: string },
    platformCode: "" as string,
    platformClubs: [] as any[],
    platformLoading: false as boolean,
    platformError: "" as string,
    platformNew: { name: "", slug: "", timezone: "Europe/Rome", plan: "starter", admin_username: "", admin_email: "", admin_password: "" } as { name: string; slug: string; timezone: string; plan: string; admin_username: string; admin_email: string; admin_password: string },
    platformAudit: [] as any[],
    platformFooter: "" as string,
    // Impersonation session (superadmin acting as club admin).
    impSession: null as null | { clubSlug: string; expiresAt: number },
    platformSettings: { base_url: "" as string, footer_text: "" as string } as { base_url: string; footer_text: string },
    platformSettingsMsg: "" as string,
    platformReports: null as null | { totals: { clubs: number; users: number; bookings: number; revenue_cents: number }; perClub: Array<{ slug: string; name: string; plan: string; isActive: boolean; users: number; bookings: number; approved: number; revenue_cents: number }> },
    // Demo wizard (prospect self-service).
    demoForm: { name: "", tennis: 1 as number, padel: 1 as number } as { name: string; tennis: number; padel: number },
    demoResult: null as null | { slug: string; name: string; url: string; admin_username: string; admin_password: string; expires_at: string },
    demoLoading: false as boolean,
    demoError: "" as string,
    clubInfoLoading: false as boolean,
    clubInfoError: "" as string,
    clubInfoSuccess: "" as string,
    clubForm: { club_name: "" as string, club_phone: "" as string, club_address: "" as string } as { club_name: string; club_phone: string; club_address: string },
    adminCourts: [] as Court[],
    adminCourtsLoading: false as boolean,
    adminCourtError: "" as string,
    adminCourtSuccess: "" as string,
    adminCourtForm: { number: null as number | null, type: "tennis" as "tennis" | "padel", name: "", surface: "", price_eur: null as number | null } as { number: number | null; type: "tennis" | "padel"; name: string; surface: string; price_eur: number | null },
    editingCourtId: null as string | null,
    adminTimetableCourtId: "" as string,
    adminTimetableRows: [] as Array<{ dayOfWeek: number; openTime: string; closeTime: string; slotDurationMinutes: number; isClosed: boolean }>,
    adminTimetableLoading: false as boolean,
    adminTimetableError: "" as string,
    adminTimetableSuccess: "" as string,
    profileForm: { username: "", email: "", first_name: "", last_name: "", mobile_code: defaultDialCode(), mobile_number: "", telegram_chat_id: "", preferred_language: "it" as Lang, preferred_sport: "" as "" | "tennis" | "padel" },
    profileLoading: false as boolean,
    profileError: "" as string,
    profileSuccess: "" as string,
    telegramLinked: false as boolean,
    telegramLinkUrl: "" as string,
    telegramLinkLoading: false as boolean,
    telegramPollTimer: null as number | null,
    editingBooking: null as string | null,
    editNotes: "" as string,
    editRent: 0 as number,
    editPlayers: "single" as "single" | "double",
    timetableAdminSelected: null as null | { bookingId: string; courtId: string; date: string; startTime: string; status: string },
    headerLangOpen: false as boolean,
    registerLangOpen: false as boolean,
    profileLangOpen: false as boolean,
    adminMobileOpen: false as boolean,
    settingsMenuOpen: false as boolean,

    t(key: string): string {
      return translate(this.lang, key);
    },

    // Phone: country code selector + national number → full digits-only
    // E.164 without "+" (e.g. +39 + 3331234567 → 393331234567), as persisted in users.mobile.
    fullMobile(code: string, number: string): string {
      const cc = String(code || "").replace(/\D/g, "");
      const nn = String(number || "").replace(/\D/g, "").replace(/^0+/, "");
      if (!nn) return "";
      return cc + nn;
    },
    splitMobile(full: string): { code: string; number: string } {
      const digits = String(full || "").replace(/\D/g, "").replace(/^00/, "");
      const codes = this.countryCodes.map((c) => c.code.replace(/\D/g, "")).sort((a, b) => b.length - a.length);
      for (const cc of codes) {
        if (cc && digits.startsWith(cc) && digits.length > cc.length) return { code: "+" + cc, number: digits.slice(cc.length) };
      }
      return { code: "+39", number: digits };
    },

    flagUrl(lang: string): string {
      const code = lang === "en" ? "gb" : lang;
      return `https://flagcdn.com/w20/${code}.png`;
    },

    async setLang(lang: Lang) {
      // Single-locale clubs have no language UI; ignore anything outside the set.
      if (this.clubLocales.length && !this.clubLocales.includes(lang)) return;
      this.lang = lang;
      setLang(lang);
      document.title = `${this.t("app.name")} — Tennis & Padel Booking`;
      this.loadAnnouncements();
      if (this.user) {
        const token = storedToken();
        try {
          await apiFetch("/api/users/me", {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ preferred_language: lang }),
          });
        } catch {}
      }
    },

    async init() {
      // Platform area has no club context.
      if (isPlatformPath(location.pathname)) {
        this.isPlatform = true;
        this.lang = detectLang();
        setLang(this.lang);
        document.title = `${this.t("app.name")} — Platform`;
        this.loadPlatformFooter();
        const ptok = localStorage.getItem("platform_token");
        if (ptok) {
          try {
            const me = await (await platformFetch("/api/users/me", { headers: { Authorization: `Bearer ${ptok}` } })).json().catch(() => null);
            if (me?.role === "superadmin") { this.platformUser = me; this.view = "platform-clubs"; this.loadPlatformClubs(); }
            else { localStorage.removeItem("platform_token"); this.view = "platform-login"; }
          } catch { this.view = "platform-login"; }
        } else this.view = "platform-login";
        return;
      }
      // Club context: /club/:slug/ is canonical. Bare paths fall back to the
      // club directory (single club → auto-redirect).
      let slug = getClubSlug() || clubSlugFromPath(location.pathname);
      if (!slug && location.pathname !== "/clubs") {
        const clubs = await this.loadClubsList();
        if (clubs.length === 1) {
          location.replace(`/club/${clubs[0].slug}/${location.hash || ""}`);
          return;
        }
        this.view = "clubs";
        this.loadPlatformFooter();
      } else if (!slug) {
        // Dedicated directory page.
        await this.loadClubsList();
        this.view = "directory";
        this.loadPlatformFooter();
      } else {
        setClubSlug(slug);
        this.clubSlug = slug;
      }
      this.lang = detectLang();
      setLang(this.lang);
      document.title = `${this.t("app.name")} — Tennis & Padel Booking`;
      try { this.pendingIntent = JSON.parse(storedIntent() || "null"); } catch { this.pendingIntent = null; }
      if (this.clubSlug) {
        await this.loadClubInfo();
        await this.loadCourts();
        this.loadAnnouncements();
      }
      const token = storedToken();
      if (token) {
        try {
          let res: Response | null = await apiFetch("/api/users/me", { headers: { Authorization: `Bearer ${token}` } });
          if (res.status === 401) {
            // Access token expired (15m) — renew silently via the httpOnly
            // refresh cookie (7d sliding) instead of forcing a re-login.
            if (await this.refreshToken()) {
              const t2 = storedToken();
              res = await apiFetch("/api/users/me", { headers: { Authorization: `Bearer ${t2}` } });
            } else {
              clearToken();
            }
          }
          if (res?.ok) {
            const me = await res.json();
            this.user = me;
            if (me.preferred_language && ["it","en","fr","de","es"].includes(me.preferred_language)) {
              this.lang = me.preferred_language;
              setLang(this.lang);
              localStorage.setItem("lang", this.lang);
            }
            // Preset timetable filter from preferred sport (not mandatory)
            if (me.preferred_sport && ["tennis","padel"].includes(me.preferred_sport)) {
              this.filterType = me.preferred_sport;
              // reload availability with preset filter
              this.loadAvailability();
            }
            this.startTokenRefresh();
      this.checkImpSession();
          }
        } catch {}
      }
      // Renew the access token when the tab becomes visible again (sleep/wake).
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && this.user) this.refreshToken();
      });
      this.checkImpSession();
      const hash = location.hash.replace("#", "").split("?")[0];
      if (hash) this.view = hash;
      this.syncHighlight();
      window.addEventListener("hashchange", async () => {
        this.view = (location.hash.replace("#", "").split("?")[0]) || "home";
        this.syncHighlight();
        if (this.view === "admin") { this.view = "admin-bookings"; location.hash = "admin-bookings"; }
        if (this.view === "me" && this.user) this.loadBookings();
        if (this.view === "profile" && this.user) this.loadProfile();
        if (this.view === "admin-bookings" && this.user?.role === "admin") { await this.loadAdminSettings(); this.applyBookingFilterPreset(); this.loadAdminBookings(); }
        if (this.view === "admin-courts" && this.user?.role === "admin") this.loadAdminCourts();
        if (this.view === "admin-users" && this.user?.role === "admin") this.loadAdminUsers();
        if (this.view === "admin-create-user" && this.user?.role === "admin") this.loadAdminUsers();
        if (this.view === "admin-blocks" && this.user?.role === "admin") { this.loadAdminLessons(); this.loadAdminBlocks(); this.loadAdminCourts(); }
        if (this.view === "admin-club" && this.user?.role === "admin") { this.loadAdminClubInfo(); this.loadAdminSettings(); }
        if (this.view === "admin-reports" && this.user?.role === "admin") this.loadReports();
        if (this.view === "admin-notifications" && this.user?.role === "admin") { this.loadAdminSettings(); this.checkTelegramStatus(); }
        if (this.view === "admin-announcements" && this.user?.role === "admin") this.loadAdminAnnouncements();
        if (this.view === "admin-announcement-form" && this.user?.role !== "admin") { this.view = "home"; location.hash = "home"; }
        if (this.view === "admin-timetable" && this.user?.role === "admin") { await this.loadAdminCourts(); await this.loadAdminTimetable(); }
      });
      if (this.view === "me" && this.user) this.loadBookings();
      if (this.view === "profile" && this.user) this.loadProfile();
      if (this.view === "admin") { this.view = "admin-bookings"; location.hash = "admin-bookings"; }
      if (this.view === "admin-bookings" && this.user?.role === "admin") { await this.loadAdminSettings(); this.applyBookingFilterPreset(); this.loadAdminBookings(); }
      if (this.view === "admin-courts" && this.user?.role === "admin") this.loadAdminCourts();
      if (this.view === "admin-users" && this.user?.role === "admin") this.loadAdminUsers();
      if (this.view === "admin-create-user" && this.user?.role === "admin") this.loadAdminUsers();
      if (this.view === "admin-blocks" && this.user?.role === "admin") { this.loadAdminLessons(); this.loadAdminBlocks(); this.loadAdminCourts(); }
      if (this.view === "admin-club" && this.user?.role === "admin") { this.loadAdminClubInfo(); this.loadAdminSettings(); }
      if (this.view === "admin-reports" && this.user?.role === "admin") this.loadReports();
      if (this.view === "admin-notifications" && this.user?.role === "admin") { this.loadAdminSettings(); this.checkTelegramStatus(); }
      if (this.view === "admin-announcements" && this.user?.role === "admin") this.loadAdminAnnouncements();
      if (this.view === "admin-announcement-form" && this.user?.role !== "admin") { this.view = "home"; location.hash = "home"; }
      if (this.view === "admin-timetable" && this.user?.role === "admin") { await this.loadAdminCourts(); await this.loadAdminTimetable(); }
    },

    isPastSlot(slot: { start: string }): boolean {
      const tz = this.clubTimezone || "Europe/Rome";
      const today = new Date().toLocaleDateString("en-CA", { timeZone: tz });
      if (this.selectedDate < today) return true;
      if (this.selectedDate > today) return false;
      const now = new Date().toLocaleTimeString("en-GB", { timeZone: tz, hour12: false }).slice(0, 5);
      return slot.start < now;
    },

    filteredCourts() {
      if (!this.filterType) return this.courts;
      return this.courts.filter((c) => c.type === this.filterType);
    },

    async loadCourts() {
      try {
        const res = await apiFetch("/api/courts");
        if (res.ok) this.courts = await res.json();
        else this.courts = demoCourts;
        if (this.courts.length) this.loadAvailability();
      } catch {
        this.courts = demoCourts;
        this.loadAvailability();
      }
    },

    async loadAvailability() {
      for (const c of this.filteredCourts()) {
        try {
          const res = await apiFetch(`/api/availability?court_id=${c.id}&date=${this.selectedDate}`);
          const data = res.ok ? await res.json() : null;
          this.availability[c.id] = data?.slots || demoSlots();
        } catch {
          this.availability[c.id] = demoSlots();
        }
      }
    },

    async selectSlot(court: Court, slot: { start: string; end: string; status: string; bookingId?: string | null }) {
      // Admin clicking any booked/pending slot → show approve/reject inline (can reject any booking)
      const isBookedSlot = (slot as any).status === "pending_approval" || (slot as any).status === "booked";
      if (isBookedSlot && this.user?.role === "admin" && (slot as any).bookingId) {
        this.timetableAdminSelected = { bookingId: (slot as any).bookingId, courtId: court.id, date: this.selectedDate, startTime: slot.start, status: (slot as any).status };
        return;
      }
      const defaultPlayers = court.type === "padel" ? "double" as const : "single" as const;
      this.pendingIntent = { courtId: court.id, date: this.selectedDate, startTime: slot.start, courtLabel: `${court.name || `Court ${court.number}`} · ${court.type}`, courtType: court.type };
      this.confirmNotes = "";
      this.confirmRent = 0;
      this.confirmPlayers = defaultPlayers;
      storeIntent( JSON.stringify({ ...this.pendingIntent, notes: "", rentRacquets: 0, players: defaultPlayers === "single" ? 2 : 4 }));
      this.view = "confirm";
      location.hash = "confirm";
    },

    async timetableApprove() {
      if (!this.timetableAdminSelected) return;
      await this.approveBooking(this.timetableAdminSelected.bookingId);
      this.timetableAdminSelected = null;
    },

    async timetableReject() {
      if (!this.timetableAdminSelected) return;
      await this.rejectBooking(this.timetableAdminSelected.bookingId);
      this.timetableAdminSelected = null;
    },

    async confirmBooking() {
      if (!this.pendingIntent || this.confirmLoading) return;
      const payload: any = {
        court_id: this.pendingIntent.courtId,
        date: this.pendingIntent.date,
        start_time: this.pendingIntent.startTime,
        notes: this.confirmNotes || null,
        rent_racquets: this.confirmRent,
        players: this.confirmPlayers === "single" ? 2 : 4,
      };
      // Store latest choices into pendingIntent for deferred register flow
      this.pendingIntent.notes = this.confirmNotes;
      this.pendingIntent.rentRacquets = this.confirmRent;
      this.pendingIntent.players = payload.players;
      storeIntent( JSON.stringify(this.pendingIntent));

      if (!this.user) {
        this.view = "register";
        location.hash = "register";
        return;
      }
      this.confirmLoading = true;
      try {
        const token = storedToken();
        const res = await apiFetch("/api/bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        if (!res.ok) { alert("Booking failed: " + (await res.text())); return; }
        // Leave the confirm view BEFORE clearing the intent: the panel renders
        // `${pendingIntent?.date} · ...` which would flash "undefined" while
        // the post-booking reloads run with pendingIntent === null.
        this.view = "me";
        location.hash = "me";
        clearIntent();
        this.pendingIntent = null;
        await this.loadBookings();
        if (this.user?.role === "admin") await this.loadAdminBookings();
        await this.loadAvailability();
      } finally {
        this.confirmLoading = false;
      }
    },

    cancelConfirm() {
      this.view = "courts";
      location.hash = "courts";
    },

    async register() {
      this.authError = "";
      const res = await apiFetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // store the httpOnly refresh cookie (dev is cross-origin)
        body: JSON.stringify({ ...this.regForm, mobile: this.fullMobile(this.regForm.mobile_code, this.regForm.mobile_number), preferred_language: this.lang, ...(getClubSlug() ? { club_slug: getClubSlug() } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Nice localized error list instead of technical JSON
        if (data.fieldErrors || data.formErrors) {
          const lines: string[] = [];
          const fe = (data.fieldErrors || {}) as Record<string, string[]>;
          for (const [field, errs] of Object.entries(fe)) {
            const fieldLabel = this.t(`field.${field}`);
            const label = fieldLabel === `field.${field}` ? field : fieldLabel;
            const vKey = `validation.${field}`;
            const vMsg = this.t(vKey);
            const msg = vMsg === vKey ? (errs as string[]).join(", ") : vMsg;
            lines.push(`• ${label}: ${msg}`);
          }
          for (const e of (data.formErrors as string[] || [])) lines.push(`• ${e}`);
          if (lines.length === 0) lines.push(`• ${this.t("validation.generic")}`);
          this.authError = lines.join("\n");
          return;
        }
        if (data.error) {
          const errStr = String(data.error).toLowerCase();
          if (errStr.includes("already taken") || errStr.includes("unique") || errStr.includes("23505")) {
            this.authError = `• ${this.t("error.taken")}`;
          } else {
            this.authError = `• ${data.error}`;
          }
          return;
        }
        this.authError = `• ${this.t("error.registerFailed")}\n${JSON.stringify(data)}`;
        return;
      }
      if (data.token) storeToken(data.token);
      this.user = data.user || { id: "1", username: this.regForm.username, role: "visitor", preferred_language: this.lang };
      this.startTokenRefresh();
      this.checkImpSession();
      this.loadAnnouncements();
      // Registration never books: with a booking in progress, return to the
      // confirm screen (intent kept in memory + localStorage) so the user
      // submits the booking explicitly from there.
      if (this.pendingIntent) {
        this.confirmNotes = this.pendingIntent.notes || "";
        this.confirmRent = this.pendingIntent.rentRacquets ?? 0;
        this.confirmPlayers = this.pendingIntent.players === 4 ? "double" : "single";
        this.view = "confirm";
        location.hash = "confirm";
        return;
      }
      await this.loadBookings();
      // Admin lands on bookings, visitor on my bookings
      if (this.user?.role === "admin") {
        this.view = "admin-bookings";
        location.hash = "admin-bookings";
        this.loadAdminBookings(); this.loadAdminSettings();
      } else {
        this.view = "me";
        location.hash = "me";
      }
    },

    async login() {
      this.authError = "";
      this.loginChallenge = null;
      this.loginCode = "";
      const clubSlug = getClubSlug();
      const body: any = { password: this.authForm.password, ...(clubSlug ? { club_slug: clubSlug } : {}) };
      if (this.authForm.username.includes("@")) body.email = this.authForm.username; else body.username = this.authForm.username;
      const res = await apiFetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.fieldErrors || data.formErrors) {
          const lines: string[] = [];
          const fe = (data.fieldErrors || {}) as Record<string, string[]>;
          for (const [field, errs] of Object.entries(fe)) {
            const fieldLabel = this.t(`field.${field}`);
            const label = fieldLabel === `field.${field}` ? field : fieldLabel;
            const vKey = `validation.${field}`;
            const vMsg = this.t(vKey);
            const msg = vMsg === vKey ? (errs as string[]).join(", ") : vMsg;
            lines.push(`• ${label}: ${msg}`);
          }
          for (const e of (data.formErrors as string[] || [])) lines.push(`• ${e}`);
          if (lines.length === 0) lines.push(`• ${this.t("validation.generic")}`);
          this.authError = lines.join("\n");
          return;
        }
        if (data.error && String(data.error).toLowerCase().includes("invalid credentials")) {
          this.authError = `• ${this.t("error.loginFailed")}`;
        } else {
          this.authError = `• ${data.error || this.t("error.loginFailed")}`;
        }
        return;
      }
      if (data.token) storeToken(data.token);
      if (data.two_factor_required) {
        this.loginChallenge = { challenge_id: data.challenge_id, expires_at: data.expires_at };
        this.loginCode = "";
        return;
      }
      this.afterLogin(data);
    },
    async verifyLogin2fa() {      this.authError = "";
      if (!this.loginChallenge) return;
      try {
        const res = await apiFetch("/api/auth/verify-2fa", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ challenge_id: this.loginChallenge.challenge_id, code: this.loginCode.trim() }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { this.authError = `• ${data.error || this.t("error.loginFailed")}`; return; }
        if (data.token) storeToken(data.token);
        this.loginChallenge = null;
        this.loginCode = "";
        this.afterLogin(data);
      } catch (e: any) { this.authError = `• ${this.t("error.loginFailed")}`; }
    },
    afterLogin(data: any) {      this.user = data.user || null;
      this.startTokenRefresh();
      this.checkImpSession();
      this.loadAnnouncements();
      if (data.user?.preferred_language) {
        this.lang = data.user.preferred_language;
        setLang(this.lang);
        localStorage.setItem("lang", this.lang);
      }
      // Login never books: with a booking in progress, return to the confirm
      // screen (intent kept in memory + localStorage) so the user submits the
      // booking explicitly from there — same as the register() flow.
      if (this.pendingIntent) {
        this.confirmNotes = this.pendingIntent.notes || "";
        this.confirmRent = this.pendingIntent.rentRacquets ?? 0;
        this.confirmPlayers = this.pendingIntent.players === 4 ? "double" : "single";
        this.view = "confirm";
        location.hash = "confirm";
        return;
      }
      // Everyone lands on the homepage after login (announcements first).
      this.view = "home";
      location.hash = "home";
    },

    filteredBookings() {
      const today = new Date().toISOString().slice(0, 10);
      const cutoffFor = (range: string) => {
        const d = new Date(); if (range === "month") d.setMonth(d.getMonth() - 1); else if (range === "3months") d.setMonth(d.getMonth() - 3); else if (range === "6months") d.setMonth(d.getMonth() - 6);
        return d.toISOString().slice(0,10);
      };
      if (this.bookingsTab === "all") {
        const cutoff = cutoffFor(this.bookingsPastRange);
        return this.bookings.filter((b) => b.date >= cutoff);
      }
      if (this.bookingsTab === "upcoming") return this.bookings.filter((b) => b.date >= today && !["cancelled","rejected","expired"].includes(b.status));
      // past tab with range filter
      let past = this.bookings.filter((b) => b.date < today || ["cancelled","rejected","expired"].includes(b.status));
      const cutoff = cutoffFor(this.bookingsPastRange);
      past = past.filter((b) => b.date >= cutoff);
      return past;
    },

    courtLabel(b: any): string {
      if (b.courtName) return `${b.courtName} · ${b.courtType || ""}`.trim();
      const c = this.courts.find((x) => x.id === (b.courtId || b.court_id));
      if (c) return `${c.name || `Court ${c.number}`} · ${c.type}`;
      return (b.courtId || b.court_id || "").slice(0,8);
    },

    statusClass(status: string): string {
      if (status === "approved") return "bg-emerald-100 text-emerald-700";
      if (status === "pending_approval" || status === "pending_registration") return "bg-amber-100 text-amber-700";
      if (status === "rejected" || status === "cancelled" || status === "expired") return "bg-zinc-200 text-zinc-600";
      return "bg-zinc-100";
    },

    async loadBookings() {
      if (!this.user) { this.bookings = []; return; }
      this.bookingsLoading = true; this.bookingsError = "";
      try {
        const token = storedToken();
        const res = await apiFetch("/api/bookings?mine=true", { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(await res.text());
        const rows = await res.json();
        // normalize snake/camel + enrich with court info
        this.bookings = (rows as any[]).map((r) => ({
          id: r.id,
          courtId: r.courtId || r.court_id,
          date: r.date,
          startTime: (r.startTime || r.start_time || "").slice(0,5),
          endTime: (r.endTime || r.end_time || "").slice(0,5),
          status: r.status,
          notes: r.notes,
          rentRacquets: r.rentRacquets ?? r.rent_racquets ?? 0,
          priceCents: r.priceCents ?? r.price_cents ?? 0,
          players: r.players ?? 2,
          courtNumber: r.courtNumber,
          courtType: r.courtType,
          courtName: r.courtName,
        })).sort((a,b) => (a.date === b.date ? b.startTime.localeCompare(a.startTime) : b.date.localeCompare(a.date)));
      } catch (e: any) {
        this.bookingsError = e.message || String(e);
      } finally { this.bookingsLoading = false; }
    },

    async cancelBooking(id: string) {
      if (!confirm(this.t("confirm.cancelBooking"))) return;
      const token = storedToken();
      const res = await apiFetch(`/api/bookings/${id}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { alert("Cancel failed: " + await res.text()); return; }
      await this.loadBookings();
      await this.loadAvailability();
    },

    // Booking-date range for the admin queue (club timezone, Monday-start weeks).
    adminDateRange(): { from?: string; to?: string } {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: this.clubTimezone || "Europe/Rome" });
      if (this.adminDateFilter === "today") return { from: today, to: today };
      if (this.adminDateFilter === "week") {
        const d = new Date(today + "T12:00:00Z");
        const off = (d.getUTCDay() + 6) % 7; // days since Monday
        const mon = new Date(d.getTime() - off * 86400000).toISOString().slice(0, 10);
        const sun = new Date(d.getTime() + (6 - off) * 86400000).toISOString().slice(0, 10);
        return { from: mon, to: sun };
      }
      if (this.adminDateFilter === "month") {
        const [y, m] = today.split("-").map(Number);
        const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const mm = String(m).padStart(2, "0");
        return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${last}` };
      }
      if (this.adminDateFilter === "custom") {
        const r: { from?: string; to?: string } = {};
        if (this.adminDateFrom) r.from = this.adminDateFrom;
        if (this.adminDateTo) r.to = this.adminDateTo;
        return r;
      }
      return {};
    },

    async loadAdminBookings() {
      if (!this.user || this.user.role !== "admin") return;
      this.adminLoading = true; this.adminError = "";
      try {
        const token = storedToken();
        const params = new URLSearchParams();
        if (this.adminFilter) params.set("status", this.adminFilter);
        const range = this.adminDateRange();
        if (range.from) params.set("date_from", range.from);
        if (range.to) params.set("date_to", range.to);
        const qs = params.toString();
        const res = await apiFetch(`/api/bookings${qs ? `?${qs}` : ""}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(await res.text());
        const rows = await res.json();
        this.adminBookings = (rows as any[]).map((r) => ({
          id: r.id,
          courtId: r.courtId || r.court_id,
          date: r.date,
          startTime: (r.startTime || r.start_time || "").slice(0,5),
          endTime: (r.endTime || r.end_time || "").slice(0,5),
          status: r.status,
          userId: r.userId || r.user_id,
          username: r.username,
          notes: r.notes,
          rentRacquets: r.rentRacquets ?? r.rent_racquets ?? 0,
          priceCents: r.priceCents ?? r.price_cents ?? 0,
          players: r.players ?? 2,
        }));
        // Jump to the highlighted booking's page (deep link), else clamp page.
        if (this.adminHighlightId) {
          const idx = this.adminBookings.findIndex((b) => b.id === this.adminHighlightId);
          if (idx >= 0) this.adminPage = Math.floor(idx / this.adminPageSize) + 1;
        }
        if (this.adminPage > this.adminTotalPages()) this.adminPage = this.adminTotalPages();
      } catch (e: any) { this.adminError = e.message || String(e); }
      finally { this.adminLoading = false; }
    },

    async approveBooking(id: string) {
      const token = storedToken();
      const res = await apiFetch(`/api/bookings/${id}/approve`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { alert("Approve failed: " + await res.text()); return; }
      await this.loadAdminBookings(); await this.loadBookings(); await this.loadAvailability();
    },

    async rejectBooking(id: string) {
      if (!confirm(this.t("confirm.rejectBooking"))) return;
      const token = storedToken();
      const res = await apiFetch(`/api/bookings/${id}/reject`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { alert("Reject failed: " + await res.text()); return; }
      await this.loadAdminBookings(); await this.loadBookings(); await this.loadAvailability();
    },

    // Preset the bookings queue to what needs attention: with auto-approve on,
    // new bookings land approved; otherwise they await approval. Manual user
    // selection is preserved until the next entry to the view.
    applyBookingFilterPreset() {
      if (this.adminHighlightId) return; // deep link forces "all" via syncHighlight
      this.adminFilter = this.adminSettings?.auto_approve_bookings ? "approved" : "pending_approval";
      this.adminPage = 1;
    },
    adminTotalPages(): number {
      return Math.max(1, Math.ceil(this.adminBookings.length / this.adminPageSize));
    },
    pagedAdminBookings(): Array<{ id: string; courtId: string; date: string; startTime: string; endTime: string; status: string; userId?: string; username?: string; notes?: string; rentRacquets?: number; players?: number }> {
      const start = (this.adminPage - 1) * this.adminPageSize;
      return this.adminBookings.slice(start, start + this.adminPageSize);
    },
    async loadAdminSettings() {
      if (!this.user || this.user.role !== "admin") return;
      this.checkTelegramStatus();
      try {
        const token = storedToken();
        const res = await apiFetch("/api/settings", { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          this.adminSettings = await res.json();
          this.notificationForm = {
            notifications_enabled: !!this.adminSettings.notifications_enabled,
            notify_on_auto_approved: !!this.adminSettings.notify_on_auto_approved,
            notify_on_approval: this.adminSettings.notify_on_approval ?? true,
            notify_on_rejection: this.adminSettings.notify_on_rejection ?? true,
            notify_via_telegram: this.adminSettings.notify_via_telegram ?? true,
            notify_via_whatsapp: this.adminSettings.notify_via_whatsapp ?? true,
            telegram_bot_token: "",
            telegram_admin_chat_id: this.adminSettings.telegram_admin_chat_id || "",
            whatsapp_token: "",
            whatsapp_phone_number_id: this.adminSettings.whatsapp_phone_number_id || "",
            whatsapp_admin_phone: this.adminSettings.whatsapp_admin_phone || "",
          };
        }
      } catch {}
    },
    async saveNotificationSettings() {
      const token = storedToken();
      const payload: any = {
        notifications_enabled: this.notificationForm.notifications_enabled,
        notify_on_auto_approved: this.notificationForm.notify_on_auto_approved,
        notify_on_approval: this.notificationForm.notify_on_approval,
        notify_on_rejection: this.notificationForm.notify_on_rejection,
        notify_via_telegram: this.notificationForm.notify_via_telegram,
        notify_via_whatsapp: this.notificationForm.notify_via_whatsapp,
        telegram_admin_chat_id: this.notificationForm.telegram_admin_chat_id || null,
        whatsapp_phone_number_id: this.notificationForm.whatsapp_phone_number_id || null,
        whatsapp_admin_phone: this.notificationForm.whatsapp_admin_phone || null,
      };
      if (this.notificationForm.telegram_bot_token) payload.telegram_bot_token = this.notificationForm.telegram_bot_token;
      if (this.notificationForm.whatsapp_token) payload.whatsapp_token = this.notificationForm.whatsapp_token;
      const res = await apiFetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
      if (!res.ok) { this.notificationTestResult = "Save failed: " + await res.text(); return; }
      this.adminSettings = await res.json();
      this.notificationForm.telegram_bot_token = "";
      this.notificationForm.whatsapp_token = "";
      this.notificationTestResult = "Saved.";
    },
    async testNotification(channel: string) {
      this.notificationTestResult = "Sending...";
      const token = storedToken();
      const res = await apiFetch("/api/notifications/test", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ channel }) });
      const data = await res.json().catch(() => ({}));
      this.notificationTestResult = JSON.stringify(data, null, 2);
    },
    syncHighlight() {
      const hash = location.hash || "";
      const q = hash.includes("?") ? hash.split("?")[1] : "";
      const h = new URLSearchParams(q).get("highlight");
      this.adminHighlightId = h || null;
      if (h && this.view === "admin-bookings" && this.adminFilter !== "") {
        // ensure highlighted booking visible even if filter is pending_approval
        this.adminFilter = "";
        // will reload on next loadAdminBookings call — caller handles
      }
    },

    async toggleAutoApprove() {
      if (!this.adminSettings) return;
      const next = !this.adminSettings.auto_approve_bookings;
      const token = storedToken();
      const res = await apiFetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ auto_approve_bookings: next }) });
      if (!res.ok) { alert("Settings failed: " + await res.text()); return; }
      this.adminSettings.auto_approve_bookings = next;
    },

    async loadPlatformFooter() {
      try {
        const res = await apiFetch("/api/platform/public");
        if (res.ok) this.platformFooter = (await res.json()).footer_text || "";
      } catch {}
    },
    checkImpSession() {
      // Show the banner when the club token carries an impersonation claim.
      const p = decodeToken(storedToken());
      if (p?.imp && p?.exp && getClubSlug()) {
        this.impSession = { clubSlug: getClubSlug()!, expiresAt: p.exp * 1000 };
      } else {
        this.impSession = null;
      }
    },
    impCountdown(): string {
      if (!this.impSession) return "";
      const ms = Math.max(0, this.impSession.expiresAt - Date.now());
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      return `${m}:${String(s).padStart(2, "0")}`;
    },
    async accessClubAsAdmin(slug: string) {
      this.platformError = "";
      try {
        const res = await platformFetch(`/api/platform/clubs/${slug}/grant`, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { this.platformError = data.error || "grant failed"; return; }
        storeTokenFor(slug, data.token);
        window.open(`/club/${slug}/`, "_blank");
      } catch (e: any) { this.platformError = e.message || String(e); }
    },
    async endImpersonation() {
      const slug = this.impSession?.clubSlug || getClubSlug();
      try {
        // Revoke via platform token if present; the club tab has none.
        const ptok = localStorage.getItem("platform_token");
        if (ptok && slug) {
          await platformFetch(`/api/platform/clubs/${slug}/grant`, { method: "DELETE" });
        }
      } catch {}
      if (slug) clearTokenFor(slug);
      this.impSession = null;
      this.user = null;
      this.view = "home";
      location.hash = "home";
    },

    async loadClubsList() {
      this.clubsLoading = true;
      try {
        const res = await apiFetch("/api/clubs");
        if (res.ok) this.clubsList = await res.json();
      } catch {}
      finally { this.clubsLoading = false; }
      return this.clubsList;
    },

    async loadClubInfo() {
      try {
        const slug = getClubSlug() || this.clubSlug;
        const res = await apiFetch(`/api/club-info${slug ? `?slug=${encodeURIComponent(slug)}` : ""}`);
        if (res.ok) {
          const info = await res.json();
          this.clubInfo = info;
          this.clubSlug = info.slug || slug || "";
          setClubSlug(this.clubSlug || null);
          this.clubTimezone = info.timezone || "Europe/Rome";
          this.clubCurrency = info.currency || "EUR";
          this.clubLocales = Array.isArray(info.locales) && info.locales.length ? info.locales : ["it", "en", "fr", "de", "es"];
          this.clubDefaultLocale = info.default_locale || this.clubLocales[0];
          // Per-club brand: header + title follow the club name.
          document.title = `${info.club_name || this.t("app.name")} — Tennis & Padel Booking`;
          // Adopt the club default when the browser language is not enabled.
          if (!this.clubLocales.includes(this.lang)) {
            this.lang = (this.clubDefaultLocale as Lang);
            setLang(this.lang);
            localStorage.setItem("lang", this.lang);
          }
          this.clubForm = { club_name: this.clubInfo?.club_name || "", club_phone: this.clubInfo?.club_phone || "", club_address: this.clubInfo?.club_address || "" };
        }
      } catch {}
    },
    async loadAdminClubInfo() {
      if (!this.user || this.user.role !== "admin") return;
      this.clubInfoLoading = true; this.clubInfoError = ""; this.clubInfoSuccess = "";
      try {
        const token = storedToken();
        const res = await apiFetch("/api/settings", { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const s = await res.json();
          this.clubForm = { club_name: s.club_name || "", club_phone: s.club_phone || "", club_address: s.club_address || "" };
          this.clubInfo = { club_name: s.club_name, club_phone: s.club_phone, club_address: s.club_address };
        }
      } catch (e: any) { this.clubInfoError = e.message || String(e); }
      finally { this.clubInfoLoading = false; }
    },
    async saveClubInfo() {
      this.clubInfoError = ""; this.clubInfoSuccess = "";
      const token = storedToken();
      const res = await apiFetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ club_name: this.clubForm.club_name || null, club_phone: this.clubForm.club_phone || null, club_address: this.clubForm.club_address || null }) });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as any;
        if (data?.fieldErrors) {
          const lines: string[] = [];
          for (const [field, errs] of Object.entries(data.fieldErrors as Record<string, string[]>)) {
            const label = this.t(`field.${field}`) !== `field.${field}` ? this.t(`field.${field}`) : field;
            lines.push(`• ${label}: ${(errs as string[]).join(", ")}`);
          }
          this.clubInfoError = lines.join("\n");
        } else {
          this.clubInfoError = await res.text().then(t=>t.slice(0,300)).catch(()=> "Save failed");
        }
        return;
      }
      this.clubInfoSuccess = this.t("admin.club.saved");
      await this.loadAdminClubInfo();
      await this.loadClubInfo();
      setTimeout(() => { this.clubInfoSuccess = ""; }, 3000);
    },

    async loadReports() {
      if (!this.user || this.user.role !== "admin") return;
      this.reportsLoading = true; this.reportsError = "";
      this.reportsSliceData = null; this.reportsSelectedLabel = "";
      try {
        const token = storedToken();
        const res = await apiFetch(`/api/reports/bookings?period=${this.reportsPeriod}&date=${this.reportsDate}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(await res.text());
        this.reportsData = await res.json();
      } catch (e: any) { this.reportsError = e.message || String(e); }
      finally { this.reportsLoading = false; }
    },

    async selectSlice(row: { label: string; startDate: string; endDate: string }) {
      if (!this.user || this.user.role !== "admin") return;
      // Keep timeline fixed, fetch detail for clicked slice without moving the chart
      this.reportsSelectedLabel = row.label;
      try {
        const token = storedToken();
        const res = await apiFetch(`/api/reports/bookings?period=${this.reportsPeriod}&date=${row.startDate}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        this.reportsSliceData = { period: data.period, startDate: data.startDate, endDate: data.endDate, overall: data.overall, byUser: data.byUser, cancellationsByUser: data.cancellationsByUser };
      } catch (e: any) { this.reportsError = e.message || String(e); }
    },

    async loadAdminCourts() {
      if (!this.user || this.user.role !== "admin") return;
      this.adminCourtsLoading = true; this.adminCourtError = "";
      try {
        const token = storedToken();
        const res = await apiFetch("/api/courts", { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(await res.text());
        this.adminCourts = await res.json();
        if (!this.adminTimetableCourtId && this.adminCourts.length) this.adminTimetableCourtId = this.adminCourts[0].id;
      } catch (e: any) { this.adminCourtError = e.message || String(e); }
      finally { this.adminCourtsLoading = false; }
    },
    async loadAdminTimetable() {
      if (!this.adminTimetableCourtId) { this.adminTimetableError = "Select a court"; return; }
      this.adminTimetableLoading = true; this.adminTimetableError = ""; this.adminTimetableSuccess = "";
      try {
        const token = storedToken();
        const res = await apiFetch(`/api/timetable?court_id=${this.adminTimetableCourtId}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(await res.text());
        const rows: any[] = await res.json();
        const byDay: Record<number, any> = {};
        for (const r of rows) if (r.courtId) byDay[r.dayOfWeek] = r;
        this.adminTimetableRows = [1,2,3,4,5,6,0].map((dow) => {
          const r = byDay[dow];
          return {
            dayOfWeek: dow,
            openTime: r?.openTime ? String(r.openTime).slice(0,5) : "08:00",
            closeTime: r?.closeTime ? String(r.closeTime).slice(0,5) : "22:00",
            slotDurationMinutes: r?.slotDurationMinutes || (this.adminCourts.find(c=>c.id===this.adminTimetableCourtId)?.type==='padel' ? 90 : 60),
            isClosed: !!r?.isClosed,
          };
        });
      } catch (e: any) { this.adminTimetableError = e.message || String(e); }
      finally { this.adminTimetableLoading = false; }
    },
    async saveAdminTimetable(force = false) {
      if (!this.adminTimetableCourtId) return;
      this.adminTimetableLoading = true; this.adminTimetableError = ""; this.adminTimetableSuccess = "";
      try {
        const token = storedToken();
        const payload = this.adminTimetableRows.map(r => ({
          court_id: this.adminTimetableCourtId,
          day_of_week: r.dayOfWeek,
          open_time: r.isClosed ? null : r.openTime,
          close_time: r.isClosed ? null : r.closeTime,
          slot_duration_minutes: r.slotDurationMinutes,
          is_closed: r.isClosed,
        }));
        const url = force ? "/api/timetable?force=true" : "/api/timetable";
        const res = await apiFetch(url, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
        if (!res.ok) {
          const txt = await res.text();
          let msg = txt;
          try {
            const j = JSON.parse(txt);
            if (j.conflicts) {
              const base = this.t('admin.timetable.orphanError');
              msg = `${base}: ${j.conflicts.map((c:any)=>`${c.date} ${c.startTime}-${c.endTime} ${c.reason}`).join("; ")}`;
              if (!force) msg += " — " + this.t('admin.timetable.forceHint');
            } else {
              msg = j.error || txt;
            }
          } catch {}
          throw new Error(msg);
        }
        this.adminTimetableSuccess = this.t('admin.timetable.saved');
        await this.loadAvailability();
      } catch (e: any) { this.adminTimetableError = e.message || String(e); }
      finally { this.adminTimetableLoading = false; }
    },
    openAdminTimetable(courtId: string) {
      this.adminTimetableCourtId = courtId;
      this.view = "admin-timetable";
      location.hash = "admin-timetable";
      this.loadAdminTimetable();
    },

    async createCourt() {
      this.adminCourtError = ""; this.adminCourtSuccess = "";
      if (!this.adminCourtForm.number || !this.adminCourtForm.type) { this.adminCourtError = "Number and type required"; return; }
      const token = storedToken();
      const res = await apiFetch("/api/courts", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ number: this.adminCourtForm.number, type: this.adminCourtForm.type, name: this.adminCourtForm.name || null, surface: this.adminCourtForm.surface || null, base_price_cents: Math.max(0, Math.round(Number(this.adminCourtForm.price_eur || 0) * 100)) }) });
      if (!res.ok) { this.adminCourtError = await res.text(); return; }
      this.adminCourtSuccess = this.t("admin.courts.created");
      this.adminCourtForm = { number: null, type: "tennis", name: "", surface: "", price_eur: null };
      await this.loadAdminCourts(); await this.loadCourts();
    },

    startEditCourt(c: Court) {
      this.editingCourtId = c.id;
      this.adminCourtForm = { number: c.number, type: c.type as any, name: c.name || "", surface: c.surface || "", price_eur: c.base_price_cents ? Number(c.base_price_cents) / 100 : null };
    },

    cancelEditCourt() { this.editingCourtId = null; this.adminCourtForm = { number: null, type: "tennis", name: "", surface: "" }; this.adminCourtError = ""; },

    async updateCourt() {
      if (!this.editingCourtId) return;
      const token = storedToken();
      const res = await apiFetch(`/api/courts/${this.editingCourtId}`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ number: this.adminCourtForm.number, type: this.adminCourtForm.type, name: this.adminCourtForm.name || null, surface: this.adminCourtForm.surface || null, base_price_cents: Math.max(0, Math.round(Number(this.adminCourtForm.price_eur || 0) * 100)) }) });
      if (!res.ok) { this.adminCourtError = await res.text(); return; }
      this.adminCourtSuccess = this.t("admin.courts.updated");
      this.editingCourtId = null;
      this.adminCourtForm = { number: null, type: "tennis", name: "", surface: "", price_eur: null };
      await this.loadAdminCourts(); await this.loadCourts();
    },

    async deleteCourt(id: string) {
      if (!confirm(this.t("confirm.disableCourt"))) return;
      const token = storedToken();
      const res = await apiFetch(`/api/courts/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { alert("Delete failed: " + await res.text()); return; }
      await this.loadAdminCourts(); await this.loadCourts();
    },

    // Recurring lessons (blockingRules)
    adminLessons: [] as Array<{ id: string; courtId: string | null; dayOfWeek: number; startTime: string; endTime: string; reason: string; isActive: boolean }>,
    adminLessonsLoading: false as boolean,
    adminLessonError: "" as string,
    adminLessonForm: { courtId: "" as string, dayOfWeek: 1 as number, startTime: "15:00", endTime: "17:00", reason: "" } as { courtId: string; dayOfWeek: number; startTime: string; endTime: string; reason: string },
    editingLessonId: null as string | null,
    // Ad-hoc blocks (spot blocks)
    adminBlocks: [] as Array<{ id: string; courtId: string | null; startAt: string; endAt: string; reason: string }>,
    adminBlocksLoading: false as boolean,
    adminBlockError: "" as string,
    adminBlockForm: { courtId: "" as string, date: "" as string, startTime: "10:00" as string, endTime: "12:00" as string, reason: "" as string } as { courtId: string; date: string; startTime: string; endTime: string; reason: string },
    editingBlockId: null as string | null,
    adminUserForm: { username: "", email: "", password: "", first_name: "", last_name: "", role: "visitor" as string, mobile: "" } as { username: string; email: string; password: string; first_name: string; last_name: string; role: string; mobile: string },
    editingUserId: null as string | null,
    adminUserSuccess: "" as string,

    async loadAdminLessons() {
      if (!this.user || this.user.role !== "admin") return;
      this.adminLessonsLoading = true; this.adminLessonError = "";
      try {
        const token = storedToken();
        const res = await apiFetch("/api/blocking-rules", { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(await res.text());
        this.adminLessons = await res.json();
      } catch (e: any) { this.adminLessonError = e.message || String(e); }
      finally { this.adminLessonsLoading = false; }
    },

    async createLesson() {
      if (!this.adminLessonForm.reason || !this.adminLessonForm.startTime || !this.adminLessonForm.endTime) { this.adminLessonError = "Reason and times required"; return; }
      const token = storedToken();
      const payload: any = { day_of_week: this.adminLessonForm.dayOfWeek, start_time: this.adminLessonForm.startTime, end_time: this.adminLessonForm.endTime, reason: this.adminLessonForm.reason };
      if (this.adminLessonForm.courtId) payload.court_id = this.adminLessonForm.courtId;
      const res = await apiFetch("/api/blocking-rules", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
      if (!res.ok) { this.adminLessonError = await res.text(); return; }
      this.adminLessonForm.reason = "";
      await this.loadAdminLessons(); await this.loadAvailability();
    },

    startEditLesson(l: any) {
      this.editingLessonId = l.id;
      this.adminLessonForm = { courtId: l.courtId || "", dayOfWeek: l.dayOfWeek, startTime: l.startTime.slice(0,5), endTime: l.endTime.slice(0,5), reason: l.reason };
    },

    cloneLesson(l: any) {
      this.editingLessonId = null;
      this.adminLessonForm = { courtId: l.courtId || "", dayOfWeek: l.dayOfWeek, startTime: l.startTime.slice(0,5), endTime: l.endTime.slice(0,5), reason: l.reason };
      this.adminLessonError = "";
      window.scrollTo({ top: 0, behavior: "smooth" });
    },

    cancelEditLesson() {
      this.editingLessonId = null;
      this.adminLessonForm = { courtId: "", dayOfWeek: 1, startTime: "15:00", endTime: "17:00", reason: "" };
      this.adminLessonError = "";
    },

    async updateLesson() {
      if (!this.editingLessonId) return;
      if (!this.adminLessonForm.reason || !this.adminLessonForm.startTime || !this.adminLessonForm.endTime) { this.adminLessonError = "Reason and times required"; return; }
      const token = storedToken();
      const payload: any = { court_id: this.adminLessonForm.courtId || null, day_of_week: this.adminLessonForm.dayOfWeek, start_time: this.adminLessonForm.startTime, end_time: this.adminLessonForm.endTime, reason: this.adminLessonForm.reason };
      const res = await apiFetch(`/api/blocking-rules/${this.editingLessonId}`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
      if (!res.ok) { this.adminLessonError = await res.text(); return; }
      this.editingLessonId = null;
      this.adminLessonForm = { courtId: "", dayOfWeek: 1, startTime: "15:00", endTime: "17:00", reason: "" };
      await this.loadAdminLessons(); await this.loadAvailability();
    },

    // Ad-hoc blocks CRUD
    async loadAdminBlocks() {
      if (!this.user || this.user.role !== "admin") return;
      this.adminBlocksLoading = true; this.adminBlockError = "";
      try {
        const token = storedToken();
        const res = await apiFetch("/api/blocks", { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(await res.text());
        this.adminBlocks = await res.json();
      } catch (e: any) { this.adminBlockError = e.message || String(e); }
      finally { this.adminBlocksLoading = false; }
    },
    async createBlock() {
      if (!this.adminBlockForm.date || !this.adminBlockForm.startTime || !this.adminBlockForm.endTime || !this.adminBlockForm.reason) { this.adminBlockError = "Date, times and reason required"; return; }
      const token = storedToken();
      const payload: any = { start_at: `${this.adminBlockForm.date}T${this.adminBlockForm.startTime}:00.000Z`, end_at: `${this.adminBlockForm.date}T${this.adminBlockForm.endTime}:00.000Z`, reason: this.adminBlockForm.reason };
      if (this.adminBlockForm.courtId) payload.court_id = this.adminBlockForm.courtId;
      const res = await apiFetch("/api/blocks", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
      if (!res.ok) { this.adminBlockError = await res.text(); return; }
      this.adminBlockForm.reason = "";
      await this.loadAdminBlocks(); await this.loadAvailability();
    },
    startEditBlock(b: any) {
      this.editingBlockId = b.id;
      const s = new Date(b.startAt); const e = new Date(b.endAt);
      this.adminBlockForm = { courtId: b.courtId || "", date: s.toISOString().slice(0,10), startTime: s.toISOString().slice(11,16), endTime: e.toISOString().slice(11,16), reason: b.reason };
    },
    cloneBlock(b: any) {
      this.editingBlockId = null;
      const s = new Date(b.startAt); const e = new Date(b.endAt);
      this.adminBlockForm = { courtId: b.courtId || "", date: s.toISOString().slice(0,10), startTime: s.toISOString().slice(11,16), endTime: e.toISOString().slice(11,16), reason: b.reason };
      this.adminBlockError = "";
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    cancelEditBlock() {
      this.editingBlockId = null;
      this.adminBlockForm = { courtId: "", date: "", startTime: "10:00", endTime: "12:00", reason: "" };
      this.adminBlockError = "";
    },
    async updateBlock() {
      if (!this.editingBlockId) return;
      if (!this.adminBlockForm.date || !this.adminBlockForm.startTime || !this.adminBlockForm.endTime || !this.adminBlockForm.reason) { this.adminBlockError = "Date, times and reason required"; return; }
      const token = storedToken();
      const payload: any = { court_id: this.adminBlockForm.courtId || null, start_at: `${this.adminBlockForm.date}T${this.adminBlockForm.startTime}:00.000Z`, end_at: `${this.adminBlockForm.date}T${this.adminBlockForm.endTime}:00.000Z`, reason: this.adminBlockForm.reason };
      const res = await apiFetch(`/api/blocks/${this.editingBlockId}`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
      if (!res.ok) { this.adminBlockError = await res.text(); return; }
      this.editingBlockId = null;
      this.adminBlockForm = { courtId: "", date: "", startTime: "10:00", endTime: "12:00", reason: "" };
      await this.loadAdminBlocks(); await this.loadAvailability();
    },
    async deleteBlock(id: string) {
      if (!confirm(this.t("confirm.deleteBlock"))) return;
      const token = storedToken();
      const res = await apiFetch(`/api/blocks/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { alert("Delete failed: " + await res.text()); return; }
      await this.loadAdminBlocks(); await this.loadAvailability();
    },

    async deleteLesson(id: string) {
      if (!confirm(this.t("confirm.deleteRecurring"))) return;
      const token = storedToken();
      const res = await apiFetch(`/api/blocking-rules/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { alert("Delete failed: " + await res.text()); return; }
      await this.loadAdminLessons(); await this.loadAvailability();
    },

    async toggleLesson(id: string, current: boolean) {
      const token = storedToken();
      const res = await apiFetch(`/api/blocking-rules/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ is_active: !current }) });
      if (!res.ok) { alert("Toggle failed: " + await res.text()); return; }
      await this.loadAdminLessons(); await this.loadAvailability();
    },

    announcements: [] as Array<{ id: string; title: string; body: string; visibility: string; position: number; publish_start: string | null; publish_end: string | null }>,
    adminAnns: [] as Array<{ id: string; title: string; body: string; visibility: string; position: number; publish_start: string | null; publish_end: string | null; translations: Record<string, { title: string; body: string }> }>,
    annLoading: false as boolean,
    annError: "" as string,
    adminAnnLoading: false as boolean,
    adminAnnError: "" as string,
    adminAnnSuccess: "" as string,
    annForm: { title: "" as string, body: "" as string, visibility: "public" as string, publish_start: "" as string, publish_end: "" as string, tr: { en: { title: "", body: "" }, fr: { title: "", body: "" }, de: { title: "", body: "" }, es: { title: "", body: "" } } as Record<string, { title: string; body: string }> },
    editingAnnId: null as string | null,

    normAnn(r: any) {
      return {
        id: r.id,
        title: r.title,
        body: r.body,
        visibility: r.visibility || "public",
        position: r.position ?? 0,
        publish_start: r.publish_start ? String(r.publish_start).slice(0, 10) : (r.publishStart ? String(r.publishStart).slice(0, 10) : null),
        publish_end: r.publish_end ? String(r.publish_end).slice(0, 10) : (r.publishEnd ? String(r.publishEnd).slice(0, 10) : null),
        translations: r.translations || {},
      };
    },
    annStatus(a: { publish_start: string | null; publish_end: string | null }): "scheduled" | "active" | "expired" {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: this.clubTimezone || "Europe/Rome" });
      if (a.publish_start && today < a.publish_start) return "scheduled";
      if (a.publish_end && today > a.publish_end) return "expired";
      return "active";
    },
    async loadAnnouncements() {
      this.annLoading = true; this.annError = "";
      try {
        const headers: any = {};
        const token = storedToken();
        if (token) headers.Authorization = `Bearer ${token}`;
        // Logged-in users read articles in their profile language, not the UI language.
        const lang = this.user?.preferred_language || (this.user as any)?.preferredLanguage || this.lang;
        const res = await apiFetch(`/api/announcements?lang=${lang}`, { headers });
        if (!res.ok) throw new Error(await res.text());
        this.announcements = (await res.json()).map((r: any) => this.normAnn(r));
      } catch (e: any) { this.annError = e.message || String(e); }
      finally { this.annLoading = false; }
    },
    async loadAdminAnnouncements() {
      if (!this.user || this.user.role !== "admin") return;
      this.adminAnnLoading = true; this.adminAnnError = ""; this.adminAnnSuccess = "";
      try {
        const token = storedToken();
        const res = await apiFetch("/api/announcements/all", { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(await res.text());
        this.adminAnns = (await res.json()).map((r: any) => this.normAnn(r));
      } catch (e: any) { this.adminAnnError = e.message || String(e); }
      finally { this.adminAnnLoading = false; }
    },
    annPayload() {
      const tr: Record<string, { title: string; body: string }> = {};
      for (const l of ["en", "fr", "de", "es"]) {
        const t = this.annForm.tr[l];
        if (t && (t.title.trim() || t.body.trim())) tr[l] = { title: t.title.trim(), body: t.body };
      }
      return {
        title: this.annForm.title.trim(),
        body: this.annForm.body,
        visibility: this.annForm.visibility,
        publish_start: this.annForm.publish_start || null,
        publish_end: this.annForm.publish_end || null,
        translations: tr,
      };
    },
    resetAnnForm() {
      this.annForm = { title: "", body: "", visibility: "public", publish_start: "", publish_end: "", tr: { en: { title: "", body: "" }, fr: { title: "", body: "" }, de: { title: "", body: "" }, es: { title: "", body: "" } } };
      this.editingAnnId = null;
    },
    newAnnouncement() {
      this.resetAnnForm();
      this.adminAnnError = ""; this.adminAnnSuccess = "";
      this.view = "admin-announcement-form";
      location.hash = "admin-announcement-form";
    },
    async createAnnouncement() {
      this.adminAnnError = ""; this.adminAnnSuccess = "";
      if (!this.annForm.title.trim() || !this.annForm.body.trim()) { this.adminAnnError = "Title and text required"; return; }
      const token = storedToken();
      const res = await apiFetch("/api/announcements", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(this.annPayload()) });
      if (!res.ok) { this.adminAnnError = (await res.text()).slice(0, 300); return; }
      this.adminAnnSuccess = this.t("admin.ann.saved");
      this.resetAnnForm();
      await this.loadAdminAnnouncements(); await this.loadAnnouncements();
      this.view = "admin-announcements";
      location.hash = "admin-announcements";
    },
    startEditAnnouncement(a: any) {
      this.view = "admin-announcement-form";
      location.hash = "admin-announcement-form";
      this.editingAnnId = a.id;
      const tr: Record<string, { title: string; body: string }> = { en: { title: "", body: "" }, fr: { title: "", body: "" }, de: { title: "", body: "" }, es: { title: "", body: "" } };
      for (const l of ["en", "fr", "de", "es"]) {
        if (a.translations?.[l]) tr[l] = { title: a.translations[l].title || "", body: a.translations[l].body || "" };
      }
      this.annForm = { title: a.title || "", body: a.body || "", visibility: a.visibility || "public", publish_start: a.publish_start || "", publish_end: a.publish_end || "", tr };
      this.adminAnnError = ""; this.adminAnnSuccess = "";
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    cancelEditAnnouncement() {
      this.resetAnnForm();
      this.adminAnnError = ""; this.adminAnnSuccess = "";
      this.view = "admin-announcements";
      location.hash = "admin-announcements";
    },
    async updateAnnouncement() {
      if (!this.editingAnnId) return;
      this.adminAnnError = ""; this.adminAnnSuccess = "";
      if (!this.annForm.title.trim() || !this.annForm.body.trim()) { this.adminAnnError = "Title and text required"; return; }
      const token = storedToken();
      const res = await apiFetch(`/api/announcements/${this.editingAnnId}`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(this.annPayload()) });
      if (!res.ok) { this.adminAnnError = (await res.text()).slice(0, 300); return; }
      this.adminAnnSuccess = this.t("admin.ann.saved");
      this.resetAnnForm();
      await this.loadAdminAnnouncements(); await this.loadAnnouncements();
      this.view = "admin-announcements";
      location.hash = "admin-announcements";
    },
    async deleteAnnouncement(id: string) {
      if (!confirm(this.t("admin.ann.deleteConfirm"))) return;
      const token = storedToken();
      const res = await apiFetch(`/api/announcements/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { alert("Delete failed: " + await res.text()); return; }
      if (this.editingAnnId === id) this.resetAnnForm();
      await this.loadAdminAnnouncements(); await this.loadAnnouncements();
    },
    async moveAnnouncement(id: string, dir: -1 | 1) {
      const ids = this.adminAnns.map((a) => a.id);
      const i = ids.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      // optimistic reorder, confirm from server
      this.adminAnns.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      const token = storedToken();
      const res = await apiFetch("/api/announcements/reorder", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ ordered_ids: ids }) });
      if (!res.ok) { this.adminAnnError = (await res.text()).slice(0, 300); await this.loadAdminAnnouncements(); return; }
      this.adminAnns = (await res.json()).map((r: any) => this.normAnn(r));
      await this.loadAnnouncements();
    },

    async loadAdminUsers() {
      if (!this.user || this.user.role !== "admin") return;
      this.adminUsersLoading = true; this.adminUsersError = "";
      try {
        const token = storedToken();
        const params = new URLSearchParams();
        if (this.adminUsersSearch) params.set("q", this.adminUsersSearch);
        if (this.adminUsersRole) params.set("role", this.adminUsersRole);
        const res = await apiFetch(`/api/users?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(await res.text());
        this.adminUsers = await res.json();
      } catch (e: any) { this.adminUsersError = e.message || String(e); }
      finally { this.adminUsersLoading = false; }
    },

    async createAdminUser() {
      this.adminUsersError = ""; this.adminUserSuccess = "";
      if (!this.adminUserForm.username || !this.adminUserForm.password || !this.adminUserForm.first_name || !this.adminUserForm.last_name) { this.adminUsersError = "Username, password, first/last name required (email optional)"; return; }
      const token = storedToken();
      const res = await apiFetch("/api/users", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ username: this.adminUserForm.username, email: this.adminUserForm.email, password: this.adminUserForm.password, first_name: this.adminUserForm.first_name, last_name: this.adminUserForm.last_name, role: this.adminUserForm.role, preferred_language: this.clubDefaultLocale || "it" }) });
      if (!res.ok) { this.adminUsersError = await res.text(); return; }
      this.adminUserSuccess = this.t("admin.users.created");
      this.adminUserForm = { username: "", email: "", password: "", first_name: "", last_name: "", role: "visitor", mobile: "" };
      await this.loadAdminUsers();
    },

    startEditUser(u: any) {
      this.editingUserId = u.id;
      this.adminUserForm = { username: u.username, email: u.email, password: "", first_name: u.first_name, last_name: u.last_name, role: u.role, mobile: u.mobile || "" };
    },

    cancelEditUser() { this.editingUserId = null; this.adminUserForm = { username: "", email: "", password: "", first_name: "", last_name: "", role: "visitor", mobile: "" }; this.adminUsersError = ""; },

    async updateAdminUser() {
      if (!this.editingUserId) return;
      const token = storedToken();
      const payload: any = { username: this.adminUserForm.username, email: this.adminUserForm.email, first_name: this.adminUserForm.first_name, last_name: this.adminUserForm.last_name, role: this.adminUserForm.role, mobile: this.adminUserForm.mobile || null };
      if (this.adminUserForm.password) (payload as any).password = this.adminUserForm.password;
      const res = await apiFetch(`/api/users/${this.editingUserId}`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
      if (!res.ok) { this.adminUsersError = await res.text(); return; }
      this.adminUserSuccess = this.t("admin.users.updated");
      this.editingUserId = null;
      this.adminUserForm = { username: "", email: "", password: "", first_name: "", last_name: "", role: "visitor", mobile: "" };
      await this.loadAdminUsers();
    },

    async deleteAdminUser(id: string) {
      if (!confirm(this.t("confirm.deleteUser"))) return;
      const token = storedToken();
      const res = await apiFetch(`/api/users/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { alert("Delete failed: " + await res.text()); return; }
      await this.loadAdminUsers();
    },

    viewUser(u: any) {
      this.viewedUserBack = this.view;
      this.viewedUser = u;
      this.view = "admin-view-user";
      location.hash = "admin-view-user";
    },

    async viewUserById(userId: string) {
      if (!userId) return;
      this.viewedUserBack = this.view;
      let u = this.adminUsers.find((x: any) => String(x.id) === String(userId));
      if (!u) {
        try {
          const token = storedToken();
          const res = await apiFetch(`/api/users`, { headers: { Authorization: `Bearer ${token}` } });
          if (res.ok) {
            const rows = await res.json();
            u = rows.find((x: any) => String(x.id) === String(userId));
          }
        } catch {}
      }
      if (u) {
        // viewUser will set viewedUserBack, but we already set it — avoid double overwrite
        this.viewedUser = u;
        this.view = "admin-view-user";
        location.hash = "admin-view-user";
      } else {
        const b = this.adminBookings.find((x: any) => String(x.userId) === String(userId));
        this.viewedUser = { id: userId, username: b?.username || String(userId).slice(0,8), email: "", first_name: "", last_name: "", role: "visitor", mobile: "", gender: "", birthdate: "", preferred_language: "it", preferred_sport: "" };
        this.view = "admin-view-user";
        location.hash = "admin-view-user";
      }
    },

    backFromViewUser() {
      const back = this.viewedUserBack && this.viewedUserBack !== "admin-view-user" ? this.viewedUserBack : "admin-users";
      this.view = back;
      location.hash = back;
    },

    async loadProfile() {
      if (!this.user) return;
      this.profileLoading = true; this.profileError = ""; this.profileSuccess = "";
      try {
        const token = storedToken();
        const res = await apiFetch("/api/users/me", { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(await res.text());
        const me = await res.json();
        this.profileForm = {
          username: me.username || "",
          email: me.email || "",
          first_name: me.first_name || me.firstName || "",
          last_name: me.last_name || me.lastName || "",
          mobile_code: this.splitMobile(me.mobile || "").code,
          mobile_number: this.splitMobile(me.mobile || "").number,
          telegram_chat_id: me.telegram_chat_id || me.telegramChatId || "",
          preferred_language: me.preferred_language || me.preferredLanguage || this.lang,
          preferred_sport: me.preferred_sport || me.preferredSport || "",
        };
        this.user = me;
        await this.checkTelegramStatus();
      } catch (e: any) { this.profileError = e.message || String(e); }
      finally { this.profileLoading = false; }
    },

    async saveProfile() {
      this.profileError = ""; this.profileSuccess = "";
      const token = storedToken();
      const payload: any = {};
      if (this.profileForm.username) payload.username = this.profileForm.username;
      payload.email = this.profileForm.email ? this.profileForm.email : null;
      if (this.profileForm.first_name) payload.first_name = this.profileForm.first_name;
      if (this.profileForm.last_name) payload.last_name = this.profileForm.last_name;
      payload.mobile = this.fullMobile(this.profileForm.mobile_code, this.profileForm.mobile_number) || null;
      if (this.profileForm.preferred_language) payload.preferred_language = this.profileForm.preferred_language;
      if (this.profileForm.preferred_sport !== undefined) payload.preferred_sport = this.profileForm.preferred_sport || null;
      const res = await apiFetch("/api/users/me", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
      if (!res.ok) { this.profileError = await res.text(); return; }
      const updated = await res.json();
      this.profileSuccess = this.t("profile.updated");
      if (updated.preferred_language) { this.lang = updated.preferred_language; setLang(this.lang); localStorage.setItem("lang", this.lang); }
      this.user = { ...this.user, ...updated };
      this.loadAnnouncements();
      if (updated.preferred_sport !== undefined) {
        this.filterType = updated.preferred_sport || "";
        if (this.view === "courts") this.loadAvailability();
      }
      await this.checkTelegramStatus();
    },
    // Silent session renewal via the httpOnly refresh cookie (7d sliding).
    // Returns true if a fresh access token was stored.
    async refreshToken(): Promise<boolean> {
      if (this._refreshing) return !!storedToken();
      this._refreshing = true;
      try {
        const res = await apiFetch("/api/auth/refresh", { method: "POST", credentials: "include" });
        if (!res.ok) {
          if (res.status === 401) {
            // Refresh session dead — drop everything, user must login again.
            this.stopTokenRefresh();
            clearToken();
            this.user = null;
          }
          return false;
        }
        const data = await res.json();
        if (data.token) {
          storeToken(data.token);
          if (data.user) this.user = { ...this.user, ...data.user };
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        this._refreshing = false;
      }
    },
    // Keep the access token alive while the app is open (15m life → renew every 10m).
    startTokenRefresh() {
      this.stopTokenRefresh();
      this._refreshTimer = window.setInterval(() => { this.refreshToken(); }, 10 * 60 * 1000);
    },
    stopTokenRefresh() {
      if (this._refreshTimer) clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    },
    async checkTelegramStatus() {
      try {
        const token = storedToken();
        if (!token) { this.telegramLinked = false; return; }
        const res = await apiFetch("/api/telegram/status", { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const j = await res.json();
          this.telegramLinked = !!j.linked;
        }
      } catch { this.telegramLinked = false; }
    },
    async createTelegramLink() {
      this.telegramLinkLoading = true;
      try {
        const token = storedToken();
        const res = await apiFetch("/api/telegram/link", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(await res.text());
        const j = await res.json();
        this.telegramLinkUrl = j.url;
        window.open(j.url, "_blank");
        // poll status every 3s for 2 minutes
        if (this.telegramPollTimer) clearInterval(this.telegramPollTimer);
        let attempts = 0;
        this.telegramPollTimer = window.setInterval(async () => {
          attempts++;
          await this.checkTelegramStatus();
          if (this.telegramLinked || attempts > 40) {
            if (this.telegramPollTimer) clearInterval(this.telegramPollTimer);
            this.telegramPollTimer = null;
            if (this.telegramLinked) this.telegramLinkUrl = "";
          }
        }, 3000);
      } catch (e: any) { this.profileError = e.message || String(e); this.notificationTestResult = e.message || String(e); }
      finally { this.telegramLinkLoading = false; }
    },
    async unlinkTelegram() {
      const token = storedToken();
      const res = await apiFetch("/api/telegram/unlink", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) { this.telegramLinked = false; this.telegramLinkUrl = ""; }
    },

    fmtPrice(cents: any): string {
      const v = Number(cents) || 0;
      if (v <= 0) return "";
      try {
        return new Intl.NumberFormat(this.lang, { style: "currency", currency: this.clubCurrency || "EUR" }).format(v / 100);
      } catch { return `${(v / 100).toFixed(2)} €`; }
    },
    priceForCourt(courtId: string): number {
      const c = (this.courts || []).find((x: any) => String(x.id) === String(courtId)) || (this.adminCourts || []).find((x: any) => String(x.id) === String(courtId));
      return Number((c as any)?.base_price_cents ?? 0) || 0;
    },

    // ---- Platform (superadmin) ----
    async platformLogin() {
      this.platformError = "";
      try {
        const body: any = { password: this.platformForm.password };
        if (this.platformForm.username.includes("@")) body.email = this.platformForm.username; else body.username = this.platformForm.username;
        const res = await platformFetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || (data.user?.role !== "superadmin" && !data.two_factor_required)) { this.platformError = data.error || "login failed"; return; }
        if (data.two_factor_required) {
          this.platformChallenge = { challenge_id: data.challenge_id, expires_at: data.expires_at };
          this.platformCode = "";
          return;
        }
        localStorage.setItem("platform_token", data.token);
        this.platformUser = data.user;
        this.view = "platform-clubs";
        this.loadPlatformClubs();
      } catch (e: any) { this.platformError = e.message || String(e); }
    },
    async platformVerify2fa() {
      this.platformError = "";
      if (!this.platformChallenge) return;
      try {
        const res = await platformFetch("/api/auth/verify-2fa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challenge_id: this.platformChallenge.challenge_id, code: this.platformCode.trim() }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { this.platformError = data.error || "verification failed"; return; }
        localStorage.setItem("platform_token", data.token);
        this.platformUser = data.user;
        this.platformChallenge = null;
        this.platformCode = "";
        this.view = "platform-clubs";
        this.loadPlatformClubs();
      } catch (e: any) { this.platformError = e.message || String(e); }
    },
    platformLogout() {
      localStorage.removeItem("platform_token");
      this.platformUser = null;
      this.view = "platform-login";
    },
    async loadPlatformClubs() {
      this.platformLoading = true; this.platformError = "";
      try {
        const res = await platformFetch("/api/platform/clubs");
        if (!res.ok) throw new Error(await res.text());
        this.platformClubs = await res.json();
      } catch (e: any) { this.platformError = e.message || String(e); }
      finally { this.platformLoading = false; }
    },
    async createPlatformClub() {
      this.platformError = "";
      try {
        const res = await platformFetch("/api/platform/clubs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(this.platformNew) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { this.platformError = data.error || JSON.stringify(data); return; }
        this.platformNew = { name: "", slug: "", timezone: "Europe/Rome", plan: "starter", admin_username: "", admin_email: "", admin_password: "" };
        await this.loadPlatformClubs();
        this.view = "platform-clubs";
      } catch (e: any) { this.platformError = e.message || String(e); }
    },
    async savePlatformClub(c: any) {
      this.platformError = "";
      try {
        const res = await platformFetch(`/api/platform/clubs/${c.slug}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: c.plan, is_active: c.isActive, is_listed: c.isListed }) });
        if (!res.ok) this.platformError = await res.text();
        else await this.loadPlatformClubs();
      } catch (e: any) { this.platformError = e.message || String(e); }
    },
    async loadPlatformAudit() {
      try {
        const res = await platformFetch("/api/platform/audit");
        if (res.ok) this.platformAudit = await res.json();
      } catch {}
    },
    auditLabel(action: string): string {
      const map: Record<string, string> = {
        "platform.club.create": "auditClubCreate",
        "platform.club.patch": "auditClubPatch",
        "platform.club.seed": "auditClubSeed",
        "platform.demo.ensure": "auditDemoEnsure",
        "platform.demo.reset": "auditDemoReset",
        "platform.demo.cleanup": "auditDemoCleanup",
        "platform.settings": "auditSettings",
        "platform.abuse.unblock": "auditAbuseUnblock",
        "platform.impersonate.grant": "auditImpGrant",
        "platform.impersonate.revoke": "auditImpRevoke",
        "platform.admin.reset-password": "auditAdminReset",
      };
      const key = map[action];
      if (!key) return action;
      const v = this.t(`platform.${key}`);
      return v === `platform.${key}` ? action : v;
    },
    fmtDateTime(iso: any): string {
      try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return String(iso || "");
        return d.toLocaleString(this.lang, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      } catch { return String(iso || ""); }
    },
    metaText(meta: any): string {
      if (!meta) return "";
      try {
        const o = typeof meta === "string" ? JSON.parse(meta) : meta;
        return Object.entries(o).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ");
      } catch { return String(meta); }
    },
    async loadPlatformSettings() {
      this.platformSettingsMsg = "";
      try {
        const res = await platformFetch("/api/platform/settings");
        if (res.ok) this.platformSettings = await res.json();
      } catch (e: any) { this.platformSettingsMsg = e.message || String(e); }
    },
    async savePlatformSettings() {
      this.platformSettingsMsg = "";
      try {
        const res = await platformFetch("/api/platform/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(this.platformSettings) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { this.platformSettingsMsg = data.error || "save failed"; return; }
        this.platformSettings = data;
      } catch (e: any) { this.platformSettingsMsg = e.message || String(e); }
    },
    async loadPlatformReports() {
      this.platformError = "";
      try {
        const res = await platformFetch("/api/platform/reports");
        if (!res.ok) throw new Error(await res.text());
        this.platformReports = await res.json();
      } catch (e: any) { this.platformError = e.message || String(e); }
    },
    async ensureDemo() {
      this.platformError = "";
      try {
        const res = await platformFetch("/api/platform/demo/ensure", { method: "POST" });
        if (!res.ok) this.platformError = await res.text();
        else await this.loadPlatformClubs();
      } catch (e: any) { this.platformError = e.message || String(e); }
    },
    async resetDemo() {
      this.platformError = "";
      try {
        const res = await platformFetch("/api/platform/clubs/demo/reset", { method: "POST" });
        if (!res.ok) this.platformError = await res.text();
      } catch (e: any) { this.platformError = e.message || String(e); }
    },
    async cleanupDemos() {
      this.platformError = "";
      try {
        const res = await platformFetch("/api/platform/demo/cleanup", { method: "POST" });
        if (!res.ok) this.platformError = await res.text();
        else await this.loadPlatformClubs();
      } catch (e: any) { this.platformError = e.message || String(e); }
    },

    // ---- Demo wizard (prospect self-service) ----
    async surpriseDemoName() {
      try {
        const res = await apiFetch("/api/demo/names");
        if (res.ok) {
          const j = await res.json();
          if (j.names?.length) this.demoForm.name = j.names[Math.floor(Math.random() * j.names.length)];
        }
      } catch {}
    },
    async startDemo() {
      this.demoLoading = true; this.demoError = ""; this.demoResult = null;
      try {
        const res = await apiFetch("/api/demo/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ display_name: this.demoForm.name || null, courts: [{ type: "tennis", count: Number(this.demoForm.tennis) || 0 }, { type: "padel", count: Number(this.demoForm.padel) || 0 }] }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { this.demoError = data.error || "demo failed"; return; }
        this.demoResult = data;
      } catch (e: any) { this.demoError = e.message || String(e); }
      finally { this.demoLoading = false; }
    },

    async requestTwoFaCode(action: "enable" | "disable") {
      this.twoFa = { pendingAction: action, code: "", msg: "" };
      try {
        const token = storedToken();
        const res = await apiFetch("/api/settings/2fa/code", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { this.twoFa.msg = data.error || "failed"; this.twoFa.pendingAction = ""; return; }
        this.twoFa.msg = "";
      } catch (e: any) { this.twoFa.msg = e.message || String(e); this.twoFa.pendingAction = ""; }
    },
    async confirmTwoFaCode() {
      if (!this.twoFa.pendingAction) return;
      try {
        const token = storedToken();
        const res = await apiFetch("/api/settings/2fa/confirm", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: this.twoFa.pendingAction, code: this.twoFa.code.trim() }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { this.twoFa.msg = data.error || "verification failed"; return; }
        this.twoFa = { pendingAction: "", code: "", msg: "" };
        await this.loadAdminSettings();
      } catch (e: any) { this.twoFa.msg = e.message || String(e); }
    },

    startEditBooking(b: any) {
      this.editingBooking = b.id;
      this.editNotes = b.notes || "";
      this.editRent = b.rentRacquets ?? 0;
      this.editPlayers = b.players === 4 ? "double" : "single";
    },

    cancelEditBooking() { this.editingBooking = null; },

    async saveEditBooking(id: string) {
      const token = storedToken();
      const payload: any = { notes: this.editNotes || null, rent_racquets: this.editRent, players: this.editPlayers === "single" ? 2 : 4 };
      const res = await apiFetch(`/api/bookings/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
      if (!res.ok) { alert("Edit failed: " + await res.text()); return; }
      this.editingBooking = null;
      await this.loadBookings();
      if (this.user?.role === "admin") await this.loadAdminBookings();
    },

    async logout() {
      this.stopTokenRefresh();
      try {
        await apiFetch("/api/auth/logout", { method: "POST", credentials: "include" });
      } catch {}
      clearToken();
      // Drop any in-progress booking: it must not survive the logout and get
      // auto-submitted by the next login()'s deferred-intent handler.
      clearIntent();
      this.pendingIntent = null;
      this.confirmNotes = "";
      this.confirmRent = 0;
      this.user = null;
      this.view = "home";
      this.loadAnnouncements();
    },
  };
}

const demoCourts: Court[] = [
  { id: "c1", number: 1, type: "tennis", name: "Central Tennis", surface: "clay", is_active: true },
  { id: "c2", number: 2, type: "tennis", surface: "synthetic", is_active: true },
  { id: "c3", number: 3, type: "padel", name: "Padel 1", is_active: true },
  { id: "c4", number: 4, type: "padel", name: "Padel 2", is_active: true },
];
function demoSlots() {
  const slots: Array<{ start: string; end: string; status: string }> = [];
  for (let h = 8; h < 22; h++) slots.push({ start: `${String(h).padStart(2, "0")}:00`, end: `${String(h + 1).padStart(2, "0")}:00`, status: Math.random() > 0.7 ? "booked" : "available" });
  return slots;
}

// @ts-ignore
window.app = app;
Alpine.start();
