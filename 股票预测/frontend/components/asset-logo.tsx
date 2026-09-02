"use client";

import { ChartNoAxesCombined } from "lucide-react";
import { useEffect, useState } from "react";
import type { Asset } from "@/lib/types";

const REMOTE_LOGO_REVISION = "20260902";
const MAX_REMOTE_LOGO_RETRIES = 2;

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
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const localLogo = LOCAL_ASSET_LOGOS[asset.symbol];
  const showLogo = Boolean(localLogo || (["stock", "etf"].includes(asset.asset_type) && !REMOTE_LOGO_UNAVAILABLE.has(asset.symbol))) && !failed;
  const logoSource = localLogo || `/api/assets/logo?symbol=${encodeURIComponent(asset.symbol)}&v=${REMOTE_LOGO_REVISION}&retry=${retry}`;

  useEffect(() => {
    setFailed(false);
    setRetry(0);
  }, [asset.symbol]);

  return (
    <span className={`asset-logo ${size}`} aria-hidden="true">
      <ChartNoAxesCombined />
      {showLogo && <img
        src={logoSource}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => {
          if (!localLogo && retry < MAX_REMOTE_LOGO_RETRIES) {
            setRetry((current) => current + 1);
            return;
          }
          setFailed(true);
        }}
      />}
    </span>
  );
}
