"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { useApp } from "./providers";

export function PwaRuntime() {
  const { language } = useApp();
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      const register = () => { void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined); };
      if (document.readyState === "complete") register();
      else window.addEventListener("load", register, { once: true });
    }
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (online) return null;
  return <div className="offline-banner" role="status"><WifiOff size={15} />{language === "zh" ? "当前离线，正在显示已缓存数据；操作会在联网后同步。" : "You are offline. Cached data is shown and changes will sync when connected."}</div>;
}

