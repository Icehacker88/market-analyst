"use client";

import { clearAuthSession, deleteAccountApi, getAuthConfig, getCurrentUser, loginWithEmailApi, signupWithEmailApi, startAppleLogin, storeAuthSession } from "@/lib/api";
import { clearPrivateStorage } from "@/lib/private-storage";
import { clearQueuedStatePatches } from "@/lib/offline-store";
import { trackEvent } from "@/lib/analytics";
import type { AuthUser } from "@/lib/types";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  configured: boolean;
  googleEnabled: boolean;
  appleEnabled: boolean;
  signupEnabled: boolean;
  callbackMessage: "confirmed" | "oauth" | "";
  clearCallbackMessage: () => void;
  loginWithEmail: (email: string, password: string) => Promise<AuthUser>;
  signupWithEmail: (email: string, password: string, name: string) => Promise<AuthUser>;
  loginWithGoogle: () => void;
  loginWithApple: () => void;
  deleteAccount: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [appleEnabled, setAppleEnabled] = useState(false);
  const [signupEnabled, setSignupEnabled] = useState(true);
  const [callbackMessage, setCallbackMessage] = useState<"confirmed" | "oauth" | "">("");

  const epoch = useRef(0);
  const mutationRunning = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    const url = new URL(window.location.href);
    const auth = url.searchParams.get("auth");
    if (auth === "google" || auth === "apple") setCallbackMessage("oauth");
    url.searchParams.delete("auth");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    void getAuthConfig().then((config) => {
      if (!active) return;
      setGoogleEnabled(config.googleEnabled);
      setAppleEnabled(config.appleEnabled);
      setSignupEnabled(config.signupEnabled);
    }).catch(() => undefined);

    const verifySession = async () => {
      if (!active || mutationRunning.current) return;
      const currentEpoch = ++epoch.current;
      setUser(null);
      setLoading(true);
      try {
        // Cookie validation is authoritative, including when no local metadata exists.
        const verifiedUser = await getCurrentUser();
        if (!active || currentEpoch !== epoch.current) return;
        setUser(verifiedUser);
        if (verifiedUser) storeAuthSession({ user: verifiedUser });
        else clearAuthSession();
      } catch {
        if (!active || currentEpoch !== epoch.current) return;
        clearAuthSession();
        setUser(null);
      } finally {
        if (active && currentEpoch === epoch.current) setLoading(false);
      }
    };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === null || event.key === "orivane-auth-user-id" || event.key === "orivane-auth-user" || event.key === "orivane-auth-token") void verifySession();
    };
    const focused = () => { void verifySession(); };
    const authRejected = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string | null; scope?: string }>).detail;
      if (detail?.scope === "session") {
        // Recheck the current cookie; an old request must not sign out a newer account.
        void verifySession();
      } else if (detail?.scope === "admin") {
        setUser((current) => current && (!detail.userId || current.id === detail.userId) ? { ...current, is_admin: false } : current);
      }
    };
    void verifySession();
    window.addEventListener("storage", storageChanged);
    window.addEventListener("focus", focused);
    window.addEventListener("orivane-auth-rejected", authRejected);
    return () => {
      active = false;
      mounted.current = false;
      epoch.current += 1;
      window.removeEventListener("storage", storageChanged);
      window.removeEventListener("focus", focused);
      window.removeEventListener("orivane-auth-rejected", authRejected);
    };
  }, []);

  const beginMutation = useCallback(() => {
    if (mutationRunning.current) throw new Error("An account change is already in progress.");
    mutationRunning.current = true;
    const currentEpoch = ++epoch.current;
    setUser(null);
    setLoading(true);
    return currentEpoch;
  }, []);

  const loginWithEmail = useCallback(async (email: string, password: string) => {
    const currentEpoch = beginMutation();
    try {
      const session = await loginWithEmailApi(email, password);
      if (mounted.current && currentEpoch === epoch.current) {
        storeAuthSession(session);
        setUser(session.user);
        trackEvent("login");
      }
      return session.user;
    } finally {
      mutationRunning.current = false;
      if (mounted.current && currentEpoch === epoch.current) setLoading(false);
    }
  }, [beginMutation]);

  const signupWithEmail = useCallback(async (email: string, password: string, name: string) => {
    const currentEpoch = beginMutation();
    try {
      const session = await signupWithEmailApi(email, password, name);
      if (mounted.current && currentEpoch === epoch.current) {
        storeAuthSession(session);
        setUser(session.user);
        trackEvent("login");
      }
      return session.user;
    } finally {
      mutationRunning.current = false;
      if (mounted.current && currentEpoch === epoch.current) setLoading(false);
    }
  }, [beginMutation]);

  const signOut = useCallback(async () => {
    const userId = user?.id;
    const currentEpoch = beginMutation();
    try {
      await fetch("/api/auth/logout", {
        method: "POST", credentials: "include",
        headers: userId ? { "x-orivane-user-id": userId } : {},
      }).catch(() => undefined);
    } finally {
      clearAuthSession();
      mutationRunning.current = false;
      if (mounted.current && currentEpoch === epoch.current) setLoading(false);
    }
  }, [beginMutation, user?.id]);

  const loginWithGoogle = useCallback(() => {
    if (typeof window === "undefined") return;
    const next = `${window.location.pathname}${window.location.search}`;
    window.location.href = `/api/auth/google/start?next=${encodeURIComponent(next)}`;
  }, []);

  const loginWithApple = useCallback(() => startAppleLogin(), []);

  const deleteAccount = useCallback(async () => {
    const userId = user?.id;
    const currentEpoch = beginMutation();
    try {
      await deleteAccountApi({ expectedUserId: userId });
      if (userId) {
        await clearQueuedStatePatches(userId);
        clearPrivateStorage(userId);
      }
      clearAuthSession();
    } finally {
      mutationRunning.current = false;
      if (mounted.current && currentEpoch === epoch.current) setLoading(false);
    }
  }, [beginMutation, user?.id]);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    configured: true,
    googleEnabled,
    appleEnabled,
    signupEnabled,
    callbackMessage,
    clearCallbackMessage: () => setCallbackMessage(""),
    loginWithEmail,
    signupWithEmail,
    loginWithGoogle,
    loginWithApple,
    deleteAccount,
    signOut,
  }), [appleEnabled, callbackMessage, deleteAccount, googleEnabled, loading, loginWithApple, loginWithEmail, loginWithGoogle, signOut, signupEnabled, signupWithEmail, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
