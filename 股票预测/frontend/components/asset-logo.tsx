"use client";

import { useEffect, useRef, useState } from "react";
import type { Asset } from "@/lib/types";

import { loadAssetLogo } from "@/lib/asset-logo";

export const LOCAL_ASSET_LOGOS: Record<string, string> = {
  QQQ: "/logos/qqq.svg",
  SMH: "/logos/vaneck.svg",
  ARKK: "/logos/ark.svg",
  NIO: "/logos/nio.svg",
  XPEV: "/logos/xpeng.svg",
  LI: "/logos/li-auto.svg",
  "300965.SZ": "/logos/hyxt.svg",
  "016452.OF": "/logos/china-southern.svg",
  "^NDX": "/logos/nasdaq.svg",
  "^IXIC": "/logos/nasdaq.svg",
  "NQ=F": "/logos/cme.svg",
  "MNQ=F": "/logos/cme.svg",
  "^VIX": "/logos/cboe.svg",
};

export const REMOTE_LOGO_UNAVAILABLE = new Set(["301396.SZ"]);

export function AssetLogo({ asset, size = "medium" }: { asset: Asset; size?: "small" | "medium" | "large" }) {
  const root = useRef<HTMLSpanElement>(null);
  const [failedSymbol, setFailedSymbol] = useState<string | null>(null);
  const [remote, setRemote] = useState<{ symbol: string; url: string } | null>(null);
  const localLogo = LOCAL_ASSET_LOGOS[asset.symbol];
  const eligible = ["stock", "etf"].includes(asset.asset_type) && !REMOTE_LOGO_UNAVAILABLE.has(asset.symbol);
  const logoSource = localLogo || (remote?.symbol === asset.symbol ? remote.url : undefined);

  useEffect(() => {
    setFailedSymbol(null);
    if (localLogo || !eligible) return;
    let disposed = false;
    let objectUrl: string | undefined;
    let started = false;
    const load = () => {
      if (started) return;
      started = true;
      void loadAssetLogo(asset.symbol).then((blob) => {
        if (disposed || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setRemote({ symbol: asset.symbol, url: objectUrl });
      });
    };
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { observer?.disconnect(); load(); }
    }, { rootMargin: "200px" });
    if (observer && root.current) observer.observe(root.current);
    else load();
    return () => {
      disposed = true;
      observer?.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [asset.symbol, localLogo, eligible]);

  // No placeholder art: transparent logos let anything behind them show through,
  // so an asset without a usable logo keeps a plain circle.
  return (
    <span ref={root} className={`asset-logo ${size}`} aria-hidden="true">
      {logoSource && failedSymbol !== asset.symbol && <img
        src={logoSource}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailedSymbol(asset.symbol)}
      />}
    </span>
  );
}
