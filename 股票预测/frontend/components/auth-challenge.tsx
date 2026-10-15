"use client";
import { useEffect, useRef, useState } from "react";

type Turnstile = {
  render: (element: HTMLElement, options: { sitekey: string; action: string; size: "flexible"; callback: (token: string) => void; "expired-callback": () => void; "error-callback": () => void }) => string;
  remove: (id: string) => void;
};
declare global { interface Window { turnstile?: Turnstile } }
let loading: Promise<void> | null = null;
function loadChallenge(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => window.turnstile ? resolve() : reject(new Error("Unavailable"));
    script.onerror = () => { script.remove(); reject(new Error("Unavailable")); };
    document.head.appendChild(script);
  }).catch(error => { loading = null; throw error; });
  return loading;
}
export function AuthChallenge({ siteKey, action, onToken, language }: { siteKey: string; action: string; onToken: (token: string) => void; language: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true; let id: string | undefined;
    onToken(""); setFailed(false);
    void loadChallenge().then(() => {
      if (!active || !container.current || !window.turnstile) return;
      id = window.turnstile.render(container.current, {
        sitekey: siteKey, action, size: "flexible",
        callback: token => { if (active) { setFailed(false); onToken(token); } },
        "expired-callback": () => { if (active) onToken(""); },
        "error-callback": () => { if (active) { onToken(""); setFailed(true); } },
      });
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (id !== undefined) window.turnstile?.remove(id); };
  }, [siteKey, action, onToken, attempt]);
  return <div>
    <div ref={container} aria-label={language === "zh" ? "安全验证" : "Security check"} />
    {failed && <p role="alert">{language === "zh" ? "安全验证暂不可用。" : "Security check unavailable."} <button type="button" onClick={() => setAttempt(n => n + 1)}>{language === "zh" ? "重试" : "Retry"}</button></p>}
  </div>;
}
