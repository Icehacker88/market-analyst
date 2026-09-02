"use client";

import { useEffect, useMemo, useState } from "react";
import { searchAssets } from "@/lib/api";
import { hasExactLocalMatch, mergeAssetResults, searchLocalAssets } from "@/lib/local-asset-search";
import type { Asset } from "@/lib/types";

export function useAssetSearch(query: string, debounceMs = 180) {
  const normalized = query.trim();
  const localResults = useMemo(() => searchLocalAssets(normalized), [normalized]);
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
        setResults(mergeAssetResults(localResults, remote));
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
  }, [debounceMs, localResults, normalized]);

  return { results, remoteLoading, remoteComplete, error, hasLocalResults: localResults.length > 0 };
}
