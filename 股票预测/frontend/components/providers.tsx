"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getUserState, resolveAssets, saveUserStatePatch } from "@/lib/api";
import { messages, type Language, type MessageKey } from "@/lib/i18n";
import { canonicalizeAsset } from "@/lib/assets";
import { observeWebVitals, trackEvent } from "@/lib/analytics";
import { listQueuedStatePatches, queueStatePatch, removeQueuedStatePatch } from "@/lib/offline-store";
import { DEFAULT_USER_STATE, hasStatePatch, normalizeUserState, statePatch } from "@/lib/user-state";
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
};

const AppContext = createContext<AppContextValue | null>(null);

function AppStateProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
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
  const seenNotification = useRef<string | null>(null);

  useEffect(() => observeWebVitals(), []);

  useEffect(() => {
    const storedLanguage = (localStorage.getItem("orivane-language") || localStorage.getItem("signalview-language")) as Language | null;
    const storedTheme = (localStorage.getItem("orivane-theme") || localStorage.getItem("signalview-theme")) as "light" | "dark" | null;
    const storedFavorites = localStorage.getItem("orivane-favorites") || localStorage.getItem("signalview-favorites");
    const storedState = localStorage.getItem("orivane-user-state");
    if (storedLanguage && messages[storedLanguage]) setLanguage(storedLanguage);
    if (storedTheme) setTheme(storedTheme);
    if (storedFavorites) {
      try {
        const parsed = (JSON.parse(storedFavorites) as Asset[]).map(canonicalizeAsset);
        setFavorites([...new Map(parsed.map((asset) => [asset.symbol, asset])).values()]);
      } catch { setFavorites([]); }
    }
    if (storedState) {
      try {
        const next = normalizeUserState(JSON.parse(storedState));
        latestState.current = next;
        setUserState(next);
      } catch { setUserState(DEFAULT_USER_STATE); }
    }
  }, []);

  useEffect(() => { latestState.current = userState; }, [userState]);

  useEffect(() => {
    cloudReady.current = false;
    if (!user) return;
    setCloudSyncing(true);
    getUserState().then(async (remote) => {
      const storedAssets = (() => { try { return JSON.parse(localStorage.getItem("orivane-favorites") || "[]") as Asset[]; } catch { return []; } })();
      const localSymbols = storedAssets.map((asset) => asset.symbol);
      const remoteSymbols = remote.watchlists?.flatMap((list) => list.symbols) || [];
      const normalized = normalizeUserState(remote);
      if (!remoteSymbols.length && localSymbols.length) {
        normalized.watchlists = normalized.watchlists.length ? normalized.watchlists.map((list, index) => index === 0 ? { ...list, symbols: localSymbols } : list) : [{ ...DEFAULT_USER_STATE.watchlists[0], symbols: localSymbols }];
        const saved = await saveUserStatePatch({ watchlists: normalized.watchlists }).catch(() => null);
        if (saved) Object.assign(normalized, normalizeUserState(saved));
      }
      syncedState.current = normalized;
      latestState.current = normalized;
      setUserState(normalized);
      const symbols = [...new Set(normalized.watchlists.flatMap((list) => list.symbols))];
      if (symbols.length) {
        const assets = await resolveAssets(symbols).catch(() => []);
        setFavorites(assets.map(canonicalizeAsset));
        localStorage.setItem("orivane-favorites", JSON.stringify(assets));
      }
      cloudReady.current = true;
    }).catch(() => undefined).finally(() => {
      cloudReady.current = true;
      setCloudSyncing(false);
    });
  }, [user]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("orivane-theme", theme);
  }, [theme]);

  useEffect(() => { document.documentElement.lang = language === "zh" ? "zh-CN" : "en"; }, [language]);

  const performCloudSync = useCallback(async (candidate: UserState) => {
    if (!user || !cloudReady.current || syncRunning.current) return;
    const patch = statePatch(syncedState.current, candidate);
    if (!hasStatePatch(patch)) return;
    syncRunning.current = true;
    setCloudSyncing(true);
    try {
      const saved = normalizeUserState(await saveUserStatePatch(patch));
      syncedState.current = saved;
      const pending = statePatch(saved, latestState.current);
      if (!hasStatePatch(pending)) {
        latestState.current = saved;
        setUserState(saved);
        localStorage.setItem("orivane-user-state", JSON.stringify(saved));
      }
    } catch {
      await queueStatePatch(patch);
    } finally {
      syncRunning.current = false;
      setCloudSyncing(false);
      if (hasStatePatch(statePatch(syncedState.current, latestState.current))) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => { void performCloudSync(latestState.current); }, 250);
      }
    }
  }, [user]);

  const scheduleCloudSync = useCallback((next: UserState) => {
    if (!user || !cloudReady.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void performCloudSync(next); }, 500);
  }, [performCloudSync, user]);

  useEffect(() => {
    if (!user) return;
    const flush = async () => {
      if (!navigator.onLine) return;
      const queued = await listQueuedStatePatches();
      for (const item of queued) {
        try {
          const saved = normalizeUserState(await saveUserStatePatch(item.patch));
          syncedState.current = saved;
          await removeQueuedStatePatch(item.id);
        } catch { break; }
      }
      void performCloudSync(latestState.current);
    };
    void flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [performCloudSync, user]);

  useEffect(() => {
    const newest = userState.alert_history?.find((item) => !item.read_at);
    if (!newest || seenNotification.current === newest.id) return;
    seenNotification.current = newest.id;
    const preferences = userState.notification_preferences;
    if (!preferences?.browser_enabled || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const title = newest.title || `${newest.symbol} ${language === "zh" ? "提醒" : "alert"}`;
    const body = newest.body || `${language === "zh" ? "价格" : "Price"} ${newest.price}`;
    if (navigator.serviceWorker) {
      void navigator.serviceWorker.ready.then((registration) => registration.showNotification(title, {
        body,
        icon: "/icon.svg",
        tag: newest.id,
        data: { url: newest.deep_link || `/stocks/${newest.symbol.toLowerCase().replaceAll(".", "-")}/` },
      })).catch(() => undefined);
    }
  }, [language, userState.alert_history, userState.notification_preferences]);

  const persistState = useCallback((next: UserState) => {
    const normalized = normalizeUserState(next);
    latestState.current = normalized;
    setUserState(normalized);
    localStorage.setItem("orivane-user-state", JSON.stringify(normalized));
    scheduleCloudSync(normalized);
  }, [scheduleCloudSync]);

  const updateUserState = useCallback((update: (current: UserState) => UserState) => {
    setUserState((current) => {
      const next = normalizeUserState(update(current));
      latestState.current = next;
      localStorage.setItem("orivane-user-state", JSON.stringify(next));
      scheduleCloudSync(next);
      return next;
    });
  }, [scheduleCloudSync]);

  const toggleFavorite = useCallback((asset: Asset) => {
    const exists = favorites.some((item) => item.symbol === asset.symbol);
    trackEvent(exists ? "favorite_remove" : "favorite_add");
    const next = exists ? favorites.filter((item) => item.symbol !== asset.symbol) : [...favorites, asset];
    setFavorites(next);
    localStorage.setItem("orivane-favorites", JSON.stringify(next));
    const lists = userState.watchlists.length ? userState.watchlists : DEFAULT_USER_STATE.watchlists;
    persistState({
      ...userState,
      watchlists: lists.map((list, index) => index === 0 ? {
        ...list, symbols: exists ? list.symbols.filter((symbol) => symbol !== asset.symbol) : [...new Set([...list.symbols, asset.symbol])],
      } : list),
    });
  }, [favorites, persistState, userState]);

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
  }), [cloudSyncing, favorites, language, theme, toggleFavorite, updateUserState, userState]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return <AuthProvider><AppStateProvider><PwaRuntime />{children}</AppStateProvider></AuthProvider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used within Providers");
  return value;
}
