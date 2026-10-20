"use client";

import { useCallback, useEffect, useState } from "react";
import { getForecastScoreboard, getHomeData, SCOREBOARD_PATH, subscribeHomeResponse, type HomeResponsePath } from "@/lib/api";
import type { ForecastScoreboard, HomeData } from "@/lib/types";

type Resource<T> = { data: T | null; status: "loading" | "ready" | "stale" | "error"; refreshing: boolean; failed: boolean };
const loaders = { "/api/home": getHomeData, [SCOREBOARD_PATH]: getForecastScoreboard };
export function useHomeResource<T extends HomeData | ForecastScoreboard>(path: HomeResponsePath, delay = 0) {
  const [state, setState] = useState<Resource<T>>({ data: null, status: "loading", refreshing: false, failed: false });
  const refresh = useCallback(() => { void loaders[path](true).catch(() => undefined); }, [path]);
  useEffect(() => {
    const unsubscribe = subscribeHomeResponse(path, (event) => {
      setState((current) => {
        if (event.status === "error") return { ...current, status: current.data ? "stale" : "error", refreshing: false, failed: true };
        if (event.status === "loading") return { ...current, status: current.data ? current.status : "loading", refreshing: true, failed: false };
        const data = (event.payload as { data?: T } | undefined)?.data;
        if (!data) return { ...current, status: current.data ? "stale" : "error", refreshing: false, failed: true };
        return { data, status: event.status, refreshing: event.status === "stale", failed: false };
      });
    });
    const load = () => { void loaders[path]().catch(() => setState((current) => ({ ...current, status: current.data ? "stale" : "error", refreshing: false, failed: true }))); };
    const timer = window.setTimeout(load, delay);
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") load(); }, path === "/api/home" ? 15 * 60_000 : 60 * 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("online", load);
    document.addEventListener("visibilitychange", onVisible);
    return () => { unsubscribe(); window.clearTimeout(timer); window.clearInterval(interval); window.removeEventListener("online", load); document.removeEventListener("visibilitychange", onVisible); };
  }, [path, delay]);
  return { ...state, refresh };
}
