"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getUserState, resolveAssets, saveUserStatePatch } from "@/lib/api";
import { messages, type Language, type MessageKey } from "@/lib/i18n";
import { canonicalizeAsset } from "@/lib/assets";
import { observeWebVitals, trackEvent } from "@/lib/analytics";
import { listQueuedStatePatches, queueStatePatch, removeQueuedStatePatch } from "@/lib/offline-store";
import { DEFAULT_USER_STATE, applyUserStatePatch, hasStatePatch, normalizeUserState, statePatch } from "@/lib/user-state";
import { createPrivateStorage, privateScope, type PrivateStorage } from "@/lib/private-storage";
import type { Asset, UserState } from "@/lib/types";
import { AuthProvider, useAuth } from "./auth-provider";
import { PwaRuntime } from "./pwa-runtime";

type AppContextValue = {
  language: Language;
  toggleLanguage: () => void;
  theme: "light" | "dark";
  toggleTheme: () => void;
  t: (key: MessageKey) => string;
  favorites: Asset[];
  toggleFavorite: (asset: Asset) => void;
  isFavorite: (symbol: string) => boolean;
  userState: UserState;
  updateUserState: (update: (current: UserState) => UserState) => void;
  cloudSyncing: boolean;
  privateStorage: PrivateStorage;
};

const AppContext = createContext<AppContextValue | null>(null);

function AppStateProvider({ children, userId, pending }: { children: React.ReactNode; userId: string | null; pending: boolean }) {
  const lifecycle = useRef({ active: true, controller: new AbortController() });
  const privateStorage = useMemo(() => createPrivateStorage(pending ? null : privateScope(userId), () => lifecycle.current.active), [pending, userId]);
  const [language, setLanguage] = useState<Language>("zh");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [favorites, setFavorites] = useState<Asset[]>([]);
  const [userState, setUserState] = useState<UserState>(DEFAULT_USER_STATE);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const cloudReady = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncedState = useRef<UserState>(DEFAULT_USER_STATE);
  const latestState = useRef<UserState>(DEFAULT_USER_STATE);
  const syncRunning = useRef(false);
  const sync = useRef<() => Promise<void>>(async () => undefined);
  const seenNotification = useRef<string | null>(null);

  useEffect(() => observeWebVitals(), []);

  useLayoutEffect(() => {
    lifecycle.current.active = true;
    if (lifecycle.current.controller.signal.aborted) lifecycle.current.controller = new AbortController();
    return () => {
      lifecycle.current.active = false;
      lifecycle.current.controller.abort();
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const patch = statePatch(syncedState.current, latestState.current);
      if (userId && cloudReady.current && hasStatePatch(patch)) void queueStatePatch(userId, patch);
      cloudReady.current = false;
    };
  }, [userId]);

  useEffect(() => {
    const storedLanguage = (localStorage.getItem("orivane-language") || localStorage.getItem("signalview-language")) as Language | null;
    const storedTheme = (localStorage.getItem("orivane-theme") || localStorage.getItem("signalview-theme")) as "light" | "dark" | null;
    if (storedLanguage && messages[storedLanguage]) setLanguage(storedLanguage);
    if (storedTheme) setTheme(storedTheme);
    let initial = normalizeUserState();
    try { initial = normalizeUserState(JSON.parse(privateStorage.getItem("orivane-user-state") || "null")); } catch { /* Start empty. */ }
    latestState.current = initial;
    syncedState.current = initial;
    setUserState(initial);
    try {
      const stored = JSON.parse(privateStorage.getItem("orivane-favorites") || "[]") as Asset[];
      setFavorites([...new Map(stored.map(canonicalizeAsset).map((asset) => [asset.symbol, asset])).values()]);
    } catch { setFavorites([]); }
    if (!userId || pending) return;

    const controller = lifecycle.current.controller;
    let disposed = false;
    let initializing = false;
    const active = () => !disposed && lifecycle.current.active && !controller.signal.aborted;
    const options = { expectedUserId: userId, signal: controller.signal };
    const display = async (state: UserState) => {
      if (!active()) return;
      latestState.current = state;
      setUserState(state);
      privateStorage.setItem("orivane-user-state", JSON.stringify(state));
      const symbols = [...new Set(state.watchlists.flatMap((list) => list.symbols))];
      const assets = symbols.length ? await resolveAssets(symbols).catch(() => []) : [];
      if (!active() || latestState.current !== state) return;
      setFavorites(assets.map(canonicalizeAsset));
      privateStorage.setItem("orivane-favorites", JSON.stringify(assets));
    };
    const flush = async () => {
      if (!active() || !cloudReady.current || syncRunning.current || !navigator.onLine) return;
      syncRunning.current = true;
      setCloudSyncing(true);
      let succeeded = false;
      try {
        const queued = await listQueuedStatePatches(userId);
        if (!active()) return;
        for (const item of queued) {
          if (!active()) return;
          const saved = await saveUserStatePatch(item.patch, options);
          if (!active()) return;
          syncedState.current = normalizeUserState(saved);
          await removeQueuedStatePatch(userId, item.id);
          if (!active()) return;
        }
        const candidate = latestState.current;
        const patch = statePatch(syncedState.current, candidate);
        if (hasStatePatch(patch)) {
          const saved = normalizeUserState(await saveUserStatePatch(patch, options));
          if (!active()) return;
          const pendingPatch = statePatch(candidate, latestState.current);
          syncedState.current = saved;
          await display(applyUserStatePatch(saved, pendingPatch));
          if (!active()) return;
        }
        succeeded = true;
      } catch {
        if (active()) {
          const patch = statePatch(syncedState.current, latestState.current);
          if (hasStatePatch(patch)) await queueStatePatch(userId, patch);
        }
      } finally {
        if (active()) {
          syncRunning.current = false;
          setCloudSyncing(false);
          if (succeeded && hasStatePatch(statePatch(syncedState.current, latestState.current))) {
            if (saveTimer.current) clearTimeout(saveTimer.current);
            saveTimer.current = setTimeout(() => { if (active()) void flush(); }, 250);
          }
        }
      }
    };
    const initialize = async () => {
      if (!active() || initializing) return;
      if (cloudReady.current) return flush();
      initializing = true;
      setCloudSyncing(true);
      const beforeLoad = latestState.current;
      try {
        const remote = normalizeUserState(await getUserState(options));
        if (!active()) return;
        const queued = await listQueuedStatePatches(userId);
        if (!active()) return;
        let next = queued.reduce((state, item) => applyUserStatePatch(state, item.patch), remote);
        next = applyUserStatePatch(next, statePatch(beforeLoad, latestState.current));
        syncedState.current = remote;
        cloudReady.current = true;
        await display(next);
        if (active()) await flush();
      } catch { /* Retry on the next online event; never sync an unverified state. */ }
      finally {
        initializing = false;
        if (active()) setCloudSyncing(false);
      }
    };
    sync.current = initialize;
    void initialize();
    const online = () => { void initialize(); };
    window.addEventListener("online", online);
    return () => {
      disposed = true;
      window.removeEventListener("online", online);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [pending, privateStorage, userId]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("orivane-theme", theme);
  }, [theme]);

  useEffect(() => { document.documentElement.lang = language === "zh" ? "zh-CN" : "en"; }, [language]);

  const scheduleCloudSync = useCallback(() => {
    if (!userId || pending || !lifecycle.current.active || !cloudReady.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (lifecycle.current.active) void sync.current();
    }, 500);
  }, [pending, userId]);

  useEffect(() => {
    const newest = userState.alert_history?.find((item) => !item.read_at);
    if (!newest || seenNotification.current === newest.id) return;
    seenNotification.current = newest.id;
    const preferences = userState.notification_preferences;
    if (!preferences?.browser_enabled || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const title = newest.title || `${newest.symbol} ${language === "zh" ? "提醒" : "alert"}`;
    const body = newest.body || `${language === "zh" ? "价格" : "Price"} ${newest.price}`;
    if (navigator.serviceWorker) {
      void navigator.serviceWorker.ready.then((registration) => {
        if (!lifecycle.current.active) return;
        return registration.showNotification(title, {
        body,
        icon: "/icon.svg",
        tag: newest.id,
        data: { url: newest.deep_link || `/stocks/${newest.symbol.toLowerCase().replaceAll(".", "-")}/` },
        });
      }).catch(() => undefined);
    }
  }, [language, userState.alert_history, userState.notification_preferences]);

  const persistState = useCallback((next: UserState) => {
    if (!lifecycle.current.active || pending) return;
    const normalized = normalizeUserState(next);
    const patch = statePatch(latestState.current, normalized);
    latestState.current = normalized;
    setUserState(normalized);
    privateStorage.setItem("orivane-user-state", JSON.stringify(normalized));
    // Preserve explicit edits even if the initial cloud read is offline or still pending.
    if (userId && !cloudReady.current && hasStatePatch(patch)) void queueStatePatch(userId, patch);
    scheduleCloudSync();
  }, [pending, privateStorage, scheduleCloudSync, userId]);

  const updateUserState = useCallback((update: (current: UserState) => UserState) => {
    if (!lifecycle.current.active || pending) return;
    persistState(update(latestState.current));
  }, [pending, persistState]);

  const toggleFavorite = useCallback((asset: Asset) => {
    if (!lifecycle.current.active || pending) return;
    const exists = favorites.some((item) => item.symbol === asset.symbol);
    trackEvent(exists ? "favorite_remove" : "favorite_add");
    const next = exists ? favorites.filter((item) => item.symbol !== asset.symbol) : [...favorites, asset];
    setFavorites(next);
    privateStorage.setItem("orivane-favorites", JSON.stringify(next));
    const lists = userState.watchlists.length ? userState.watchlists : DEFAULT_USER_STATE.watchlists;
    persistState({
      ...userState,
      watchlists: lists.map((list, index) => index === 0 ? {
        ...list, symbols: exists ? list.symbols.filter((symbol) => symbol !== asset.symbol) : [...new Set([...list.symbols, asset.symbol])],
      } : list),
    });
  }, [favorites, pending, persistState, privateStorage, userState]);

  const value = useMemo<AppContextValue>(() => ({
    language,
    toggleLanguage: () => {
      const next = language === "zh" ? "en" : "zh";
      setLanguage(next);
      localStorage.setItem("orivane-language", next);
      updateUserState((current) => ({ ...current, preferred_language: next }));
    },
    theme,
    toggleTheme: () => setTheme((current) => current === "light" ? "dark" : "light"),
    t: (key) => messages[language][key],
    favorites,
    toggleFavorite,
    isFavorite: (symbol) => favorites.some((item) => item.symbol === symbol),
    userState,
    updateUserState,
    cloudSyncing,
    privateStorage,
  }), [cloudSyncing, favorites, language, privateStorage, theme, toggleFavorite, updateUserState, userState]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function AuthScopedState({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const userId = loading ? null : user?.id || null;
  const scope = loading ? "pending" : privateScope(userId);
  return <AppStateProvider key={scope} userId={userId} pending={loading}><PwaRuntime />{children}</AppStateProvider>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return <AuthProvider><AuthScopedState>{children}</AuthScopedState></AuthProvider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used within Providers");
  return value;
}
