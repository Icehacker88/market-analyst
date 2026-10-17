"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { initialResearchEntries, normalizeResearchSymbols, RESEARCH_FRESH_MS, researchDataLoader } from "@/lib/my-research-data";
import type { ResearchDataEntry } from "@/lib/my-research-data";

type ResearchState = { key: string; entries: Record<string, ResearchDataEntry>; loading: boolean; lastCheckedAt: number | null };

export function useMyResearch(inputSymbols: string[]) {
  // A new array from a parent render must not restart the data pipeline.
  const key = JSON.stringify(normalizeResearchSymbols(inputSymbols));
  const symbols = useMemo(() => JSON.parse(key) as string[], [key]);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const refresh = useCallback(() => setRefreshVersion((value) => value + 1), []);
  const previousRefresh = useRef(refreshVersion);
  // Recheck on return/online without forcing a still-fresh cached batch to the network.
  const [resumeVersion, setResumeVersion] = useState(0);
  useEffect(() => {
    const resume = () => { if (document.visibilityState !== "hidden") setResumeVersion((value) => value + 1); };
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => { window.removeEventListener("online", resume); document.removeEventListener("visibilitychange", resume); };
  }, []);
  const [state, setState] = useState<ResearchState>(() => ({ key, entries: initialResearchEntries(symbols), loading: symbols.length > 0, lastCheckedAt: null }));

  useEffect(() => {
    const controller = new AbortController();
    const force = previousRefresh.current !== refreshVersion;
    previousRefresh.current = refreshVersion;
    setState((current) => ({ key, entries: current.key === key ? current.entries : initialResearchEntries(symbols), loading: symbols.length > 0, lastCheckedAt: current.key === key ? current.lastCheckedAt : null }));
    void researchDataLoader.load(symbols, (update) => {
      if (controller.signal.aborted) return;
      setState((current) => ({
        key,
        entries: { ...(current.key === key ? current.entries : initialResearchEntries(symbols)), ...update.entries },
        loading: true,
        lastCheckedAt: Math.max(current.key === key ? current.lastCheckedAt || 0 : 0, update.lastCheckedAt || 0) || null,
      }));
    }, { force, signal: controller.signal }).finally(() => {
      if (!controller.signal.aborted) setState((current) => ({ ...current, loading: false }));
    });
    return () => controller.abort();
  }, [key, symbols, refreshVersion, resumeVersion]);

  useEffect(() => {
    if (state.key !== key || state.loading) return;
    const expirations = Object.values(state.entries).filter((entry) => entry.status === "fresh" && entry.checkedAt).map((entry) => entry.freshUntil || entry.checkedAt! + RESEARCH_FRESH_MS);
    if (!expirations.length) return;
    const timer = window.setTimeout(() => setResumeVersion((value) => value + 1), Math.max(1, Math.min(...expirations) - Date.now() + 1));
    return () => window.clearTimeout(timer);
  }, [key, state.entries, state.key, state.loading]);

  // Removed assets/account changes cannot show the previous render's entries.
  const current = state.key === key ? state : { entries: initialResearchEntries(symbols), loading: symbols.length > 0, lastCheckedAt: null };
  return { entries: current.entries, loading: current.loading, lastCheckedAt: current.lastCheckedAt, refresh };
}
