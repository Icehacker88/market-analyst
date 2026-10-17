"use client";

import { useEffect, useMemo, useState } from "react";
import { searchAssets } from "@/lib/api";
import { hasExactLocalMatch, mergeAssetResults, searchLocalAssets } from "@/lib/local-asset-search";
import { filterHomeSearchResults, searchHomeAssets } from "@/lib/home-search";
import type { Asset } from "@/lib/types";

export function useAssetSearch(query: string, debounceMs = 180, homeSemantics = false) {
  const normalized = query.trim();
  const localResults = useMemo(() => homeSemantics ? searchHomeAssets(normalized) : searchLocalAssets(normalized), [normalized, homeSemantics]);
  const [results, setResults] = useState<Asset[]>(localResults);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteComplete, setRemoteComplete] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    setResults(localResults);
    setRemoteComplete(false);
    setError(false);
    if (!normalized) {
      setRemoteLoading(false);
      return;
    }
    if (hasExactLocalMatch(normalized, localResults)) {
      setRemoteLoading(false);
      setRemoteComplete(true);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setRemoteLoading(true);
      try {
        const remote = await searchAssets(normalized, controller.signal);
        if (controller.signal.aborted) return;
        setResults(mergeAssetResults(localResults, homeSemantics ? filterHomeSearchResults(remote, normalized) : remote));
        setRemoteComplete(true);
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(true);
      } finally {
        if (!controller.signal.aborted) setRemoteLoading(false);
      }
    }, debounceMs);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [debounceMs, localResults, normalized, homeSemantics]);

  return { results, remoteLoading, remoteComplete, error, hasLocalResults: localResults.length > 0 };
}
