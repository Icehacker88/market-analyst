"use client";

import { clearAuthSession, deleteAccountApi, getAuthConfig, getCurrentUser, loginWithEmailApi, readStoredAuthUser, signupWithEmailApi, startAppleLogin, storeAuthSession } from "@/lib/api";
import { trackEvent } from "@/lib/analytics";
import type { AuthUser } from "@/lib/types";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

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

  useEffect(() => {
    let active = true;
    let oauthCallback = false;
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      const auth = url.searchParams.get("auth");
      if (auth === "google" || auth === "apple") {
        oauthCallback = true;
        setCallbackMessage("oauth");
      }
      url.searchParams.delete("auth");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
    const stored = readStoredAuthUser();
    if (stored) setUser(stored);
    const currentUserRequest = stored || oauthCallback ? getCurrentUser() : Promise.resolve(null);
    void Promise.allSettled([getAuthConfig(), currentUserRequest])
      .then(([configResult, userResult]) => {
        if (!active) return;
        if (configResult.status === "fulfilled") {
          setGoogleEnabled(configResult.value.googleEnabled);
          setAppleEnabled(configResult.value.appleEnabled);
          setSignupEnabled(configResult.value.signupEnabled);
        }
        const currentUser = userResult.status === "fulfilled" ? userResult.value : null;
        setUser(currentUser);
        if (!currentUser) clearAuthSession();
        else {
          localStorage.removeItem("orivane-auth-token");
          localStorage.setItem("orivane-auth-user", JSON.stringify(currentUser));
        }
      })
      .catch(() => {
        if (!stored) clearAuthSession();
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const loginWithEmail = useCallback(async (email: string, password: string) => {
    const session = await loginWithEmailApi(email, password);
    storeAuthSession(session);
    setUser(session.user);
    trackEvent("login");
    return session.user;
  }, []);

  const signupWithEmail = useCallback(async (email: string, password: string, name: string) => {
    const session = await signupWithEmailApi(email, password, name);
    storeAuthSession(session);
    setUser(session.user);
    trackEvent("login");
    return session.user;
  }, []);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
    clearAuthSession();
    setUser(null);
  }, []);

  const loginWithGoogle = useCallback(() => {
    if (typeof window === "undefined") return;
    const next = `${window.location.pathname}${window.location.search}`;
    window.location.href = `/api/auth/google/start?next=${encodeURIComponent(next)}`;
  }, []);

  const loginWithApple = useCallback(() => startAppleLogin(), []);

  const deleteAccount = useCallback(async () => {
    await deleteAccountApi();
    localStorage.removeItem("orivane-user-state");
    localStorage.removeItem("orivane-favorites");
    setUser(null);
  }, []);

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
