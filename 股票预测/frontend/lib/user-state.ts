import type { NotificationPreferences, UserState } from "./types";

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  email_enabled: true,
  browser_enabled: false,
  daily_digest: true,
  quiet_hours_enabled: true,
  quiet_start: "22:00",
  quiet_end: "08:00",
  timezone: "Asia/Shanghai",
  min_interval_minutes: 60,
};

export const DEFAULT_USER_STATE: UserState = {
  watchlists: [{ id: "default", name: "My Watchlist", symbols: [] }],
  alerts: [],
  alert_history: [],
  portfolios: [],
  savedScreeners: [],
  research_reviews: {},
  research_records: {},
  research_review_events: {},
  updated_at: null,
  state_revision: 0,
  daily_summary_enabled: true,
  notification_preferences: DEFAULT_NOTIFICATION_PREFERENCES,
  ai_chats: {},
};

const META_FIELDS = new Set<keyof UserState>(["updated_at", "account_email", "state_revision"]);

export function normalizeUserState(value?: Partial<UserState> | null): UserState {
  return {
    ...DEFAULT_USER_STATE,
    ...(value || {}),
    watchlists: value?.watchlists?.length ? value.watchlists : DEFAULT_USER_STATE.watchlists,
    alerts: value?.alerts || [],
    alert_history: value?.alert_history || [],
    portfolios: value?.portfolios || [],
    savedScreeners: value?.savedScreeners || [],
    research_reviews: value?.research_reviews || {},
    research_records: value?.research_records || {},
    research_review_events: value?.research_review_events || {},
    notification_preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, ...(value?.notification_preferences || {}) },
    ai_chats: value?.ai_chats || {},
  };
}

export function statePatch(previous: UserState, next: UserState): Partial<UserState> {
  const patch: Partial<UserState> = {};
  for (const key of Object.keys(next) as Array<keyof UserState>) {
    if (META_FIELDS.has(key)) continue;
    if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) {
      (patch as Record<string, unknown>)[key] = next[key];
    }
  }
  return patch;
}

export function applyUserStatePatch(current: UserState, patch: Partial<UserState>): UserState {
  return normalizeUserState({ ...current, ...patch,
    // Research records have stable IDs and no deletion operation in Round 1.
    research_records: { ...current.research_records, ...patch.research_records },
    // Immutable events: retries merge IDs, never overwrite an existing event.
    research_review_events: { ...patch.research_review_events, ...current.research_review_events },
  });
}

export function hasStatePatch(patch: Partial<UserState>): boolean {
  return Object.keys(patch).some((key) => !META_FIELDS.has(key as keyof UserState));
}

