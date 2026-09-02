"use client";

import { ApiError } from "@/lib/api";
import { LoaderCircle, LogIn, LogOut, Trash2, UserRound, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "./auth-provider";
import { useApp } from "./providers";

type Mode = "login" | "signup";

export function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { language, t } = useApp();
  const {
    user,
    loading,
    configured,
    googleEnabled,
    appleEnabled,
    signupEnabled,
    callbackMessage,
    clearCallbackMessage,
    loginWithEmail,
    signupWithEmail,
    loginWithGoogle,
    loginWithApple,
    deleteAccount,
    signOut,
  } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const modalRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => [...(modalRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])];
    requestAnimationFrame(() => (focusable()[0] || modalRef.current)?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const items = focusable();
        if (!items.length) return;
        const first = items[0];
        const last = items.at(-1)!;
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    const closeOnOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !modalRef.current?.contains(event.target)) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutside, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutside, true);
      document.body.style.overflow = previousOverflow;
      previousFocus.current?.focus();
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!callbackMessage) return;
    setSuccess(callbackMessage === "confirmed" ? t("emailConfirmed") : language === "zh" ? "登录成功" : "Signed in successfully");
    clearCallbackMessage();
  }, [callbackMessage, clearCallbackMessage, language, t]);

  if (!open) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    const fields = new FormData(event.currentTarget);
    const email = String(fields.get("email") || "").trim();
    const password = String(fields.get("password") || "");
    const name = String(fields.get("name") || "").trim();
    try {
      if (mode === "login") {
        await loginWithEmail(email, password);
        onClose();
      } else {
        const created = await signupWithEmail(email, password, name);
        if (created.confirmedAt) onClose();
        else setSuccess(t("checkEmail"));
      }
    } catch (cause) {
      const status = cause instanceof ApiError ? cause.status : undefined;
      setError(status === 401 ? t("invalidLogin") : status === 403 ? t("signupDisabled") : status === 422 ? t("invalidSignup") : t("authError"));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setBusy(true);
    try {
      await signOut();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteAccount() {
    const confirmed = window.confirm(language === "zh" ? "确认永久删除账号、云端收藏、提醒和对话记录？此操作无法撤销。" : "Permanently delete your account, cloud favorites, alerts and chats? This cannot be undone.");
    if (!confirmed) return;
    setBusy(true);
    setError("");
    try {
      await deleteAccount();
      onClose();
      window.location.assign("/");
    } catch {
      setError(language === "zh" ? "账号删除失败，请稍后重试。" : "Account deletion failed. Please try again.");
    } finally { setBusy(false); }
  }

  const title = user ? t("account") : mode === "login" ? t("login") : t("createAccount");

  return createPortal(<div className="auth-overlay" role="presentation">
    <section ref={modalRef} className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title" tabIndex={-1}>
      <header><div><span className="auth-mark"><UserRound size={17} /></span><div><h2 id="auth-title">{title}</h2><p>{user ? t("accountBody") : t("authBody")}</p></div></div><button className="auth-close" onClick={onClose} aria-label={t("close")}><X size={17} /></button></header>
      {loading ? <div className="auth-loading"><LoaderCircle className="spin" size={20} />{t("loadingAccount")}</div> : user ? <div className="auth-profile">
        {user.pictureUrl ? <img src={user.pictureUrl} alt="" referrerPolicy="no-referrer" /> : <span><UserRound size={24} /></span>}
        <strong>{user.name || user.email}</strong><small>{user.email}</small>
        <button className="auth-secondary" onClick={handleSignOut} disabled={busy}><LogOut size={15} />{t("logout")}</button>
        <button className="auth-danger" onClick={handleDeleteAccount} disabled={busy}><Trash2 size={15} />{language === "zh" ? "永久删除账号" : "Delete account permanently"}</button>
        {error && <p className="auth-message error">{error}</p>}
      </div> : !configured ? <div className="auth-unavailable"><strong>{t("authUnavailable")}</strong><p>{t("authUnavailableBody")}</p></div> : <>
        <div className="auth-modes"><button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); setSuccess(""); }}>{t("login")}</button><button className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setError(""); setSuccess(""); }} disabled={!signupEnabled}>{t("createAccount")}</button></div>
        <form className="auth-form" onSubmit={submit}>
          {mode === "signup" && <label>{t("name")}<input name="name" autoComplete="name" placeholder={language === "zh" ? "你的名字" : "Your name"} /></label>}
          <label>{t("email")}<input name="email" type="email" autoComplete="email" required placeholder="name@example.com" /></label>
          <label>{t("password")}<input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} required placeholder={t("passwordHint")} /></label>
          {error && <p className="auth-message error">{error}</p>}
          {success && <p className="auth-message success">{success}</p>}
          <button className="auth-primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={15} /> : <LogIn size={15} />}{mode === "login" ? t("login") : t("createAccount")}</button>
        </form>
        {googleEnabled && <>
          <div className="auth-divider"><span>{t("or")}</span></div>
          <button className="auth-google" onClick={loginWithGoogle} disabled={busy}>{t("continueGoogle")}</button>
        </>}
        {appleEnabled && <button className="auth-apple" onClick={loginWithApple} disabled={busy}>{language === "zh" ? "使用 Apple 继续" : "Continue with Apple"}</button>}
      </>}
    </section>
  </div>, document.body);
}
