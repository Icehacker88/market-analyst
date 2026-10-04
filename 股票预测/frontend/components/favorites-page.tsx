"use client";

import { AppLink as Link } from "./app-link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Bell, BellRing, CheckCheck, Cloud, Mail, Moon, Plus, Send, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { sendAlertTestEmail } from "@/lib/api";
import { assetPath } from "@/lib/asset-catalog";
import { trackEvent } from "@/lib/analytics";
import { formatNumber, formatPercent } from "@/lib/format";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/lib/user-state";
import type { Asset, PriceAlert } from "@/lib/types";
import { MyResearchWorkspace } from "./my-research-workspace";
import s from "./my-research.module.css";
import { ResearchNavigation } from "./research-navigation";
import { useAuth } from "./auth-provider";
import { useApp } from "./providers";

export function FavoritesPage() {
  const { cloudSyncing, language, t, updateUserState, userState } = useApp();
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const [listName, setListName] = useState("");
  const [alertSymbol, setAlertSymbol] = useState("");
  const [alertType, setAlertType] = useState<PriceAlert["type"]>("above");
  const [alertValue, setAlertValue] = useState("");
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [testingEmail, setTestingEmail] = useState(false);
  const zh = language === "zh";
  const dailySummaryEnabled = userState.daily_summary_enabled !== false;
  const notificationPreferences = { ...DEFAULT_NOTIFICATION_PREFERENCES, ...(userState.notification_preferences || {}) };
  const unreadNotifications = (userState.alert_history || []).filter((item) => !item.read_at).length;
  useEffect(() => {
    trackEvent("watchlist_view");
  }, []);

  useEffect(() => {
    const symbol = searchParams.get("alert")?.trim().toUpperCase();
    if (symbol) {
      setAlertSymbol(symbol);
      const settings = document.getElementById("research-settings") as HTMLDetailsElement | null;
      if (settings) settings.open = true;
      document.querySelector(".alerts-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [searchParams]);

  useEffect(() => {
    const revealSettings = () => {
      if (!["#alerts", "#notifications"].includes(window.location.hash)) return;
      const settings = document.getElementById("research-settings") as HTMLDetailsElement | null;
      if (settings) settings.open = true;
      document.querySelector(window.location.hash)?.scrollIntoView({ block: "start" });
    };
    revealSettings();
    window.addEventListener("hashchange", revealSettings);
    return () => window.removeEventListener("hashchange", revealSettings);
  }, []);

  function addList() {
    if (!listName.trim()) return;
    updateUserState((current) => ({ ...current, watchlists: [...current.watchlists, { id: crypto.randomUUID(), name: listName.trim(), symbols: [] }] }));
    setListName("");
  }
  function addAlert() {
    const symbol = alertSymbol.trim().toUpperCase();
    const thresholdRequired = !["signal", "invalidation"].includes(alertType);
    const numericValue = Number(alertValue);
    if (!symbol || (thresholdRequired && !Number.isFinite(numericValue))) return;
    const value = thresholdRequired ? numericValue : "any";
    updateUserState((current) => ({ ...current, alerts: [...current.alerts, { id: crypto.randomUUID(), symbol, type: alertType, value, enabled: true }] }));
    trackEvent("alert_create");
    setAlertSymbol(""); setAlertValue("");
  }
  function addPresetAlert(asset: Asset, type: PriceAlert["type"], value: number | string) {
    const duplicate = userState.alerts.some((item) => item.symbol === asset.symbol && item.type === type && String(item.value) === String(value));
    if (!duplicate) {
      updateUserState((current) => ({ ...current, alerts: [...current.alerts, { id: crypto.randomUUID(), symbol: asset.symbol, type, value, enabled: true }] }));
      trackEvent("alert_create");
    }
    setTestMessage(!duplicate ? (zh ? `${asset.symbol} 提醒已添加。` : `${asset.symbol} alert added.`) : (zh ? `${asset.symbol} 已有相同提醒。` : `${asset.symbol} already has this alert.`));
  }
  async function sendTestEmail() {
    setTestingEmail(true);
    setTestMessage(null);
    try {
      const result = await sendAlertTestEmail(language);
      setTestMessage(zh ? `测试邮件已发送到 ${result.email}` : `Test email sent to ${result.email}`);
    } catch {
      setTestMessage(zh ? "发送失败，请确认已登录且邮件服务已配置。" : "Failed to send. Confirm sign-in and email setup.");
    } finally {
      setTestingEmail(false);
    }
  }
  async function toggleBrowserNotifications() {
    if (typeof Notification === "undefined") {
      setTestMessage(zh ? "当前浏览器不支持系统通知。" : "This browser does not support system notifications.");
      return;
    }
    const enabled = !notificationPreferences.browser_enabled;
    const permission = enabled ? await Notification.requestPermission() : Notification.permission;
    if (enabled && permission !== "granted") {
      setTestMessage(zh ? "通知权限未开启，可在浏览器的网站设置中允许通知。" : "Notification permission was not granted. Enable it in site settings.");
      return;
    }
    updateUserState((current) => ({ ...current, notification_preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, ...current.notification_preferences, browser_enabled: enabled } }));
  }
  function updateNotificationPreference<Key extends keyof typeof notificationPreferences>(key: Key, value: (typeof notificationPreferences)[Key]) {
    updateUserState((current) => ({ ...current, notification_preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, ...current.notification_preferences, [key]: value } }));
  }
  function markNotificationsRead() {
    const readAt = new Date().toISOString();
    updateUserState((current) => ({ ...current, alert_history: (current.alert_history || []).map((item) => item.read_at ? item : { ...item, read_at: readAt }) }));
  }
  return <main className={`page-shell favorites-page ${s.page}`}><header className="page-title"><div><h1>{zh ? "我的研究" : "My research"}</h1><p><Cloud size={13} />{cloudSyncing ? (zh ? "正在同步" : "Syncing") : user ? (zh ? "本机保存；云端同步状态未确认" : "Saved locally; cloud sync status unconfirmed") : (zh ? "未登录 · 研究数据保存在本机" : "Signed out · Research data stays on this device")}</p></div><Link href="/" className="primary-link">{t("openDashboard")}<ArrowRight size={15} /></Link></header>
    <ResearchNavigation />
    <MyResearchWorkspace onPresetAlert={addPresetAlert} />
    {testMessage && <p className="alert-message" role="status">{testMessage}</p>}
    <details className={s.settings} id="research-settings"><summary>{zh ? "列表、提醒与通知设置" : "Lists, alerts and notification settings"}</summary>
    <section className="watchlist-manager"><header><strong>{zh ? "我的列表" : "My lists"}</strong><div><input value={listName} onChange={(event) => setListName(event.target.value)} placeholder={zh ? "新列表名称" : "New list name"} /><button onClick={addList}><Plus size={14} />{zh ? "新建" : "Create"}</button></div></header><div>{userState.watchlists.map((list, index) => <article key={list.id}><span><strong>{index === 0 ? (zh ? "默认收藏" : "Favorites") : list.name}</strong><small>{list.symbols.length} {zh ? "个资产" : "assets"}</small></span>{index > 0 && <button onClick={() => updateUserState((current) => ({ ...current, watchlists: current.watchlists.filter((item) => item.id !== list.id) }))}><Trash2 size={14} /></button>}</article>)}</div></section>
    <section className="summary-panel"><span><Mail size={15} /><strong>{zh ? "每日邮件摘要" : "Daily email summary"}</strong><small>{user ? (zh ? "发送取决于邮件服务及后台任务是否可用。" : "Delivery depends on email service and background job availability.") : (zh ? "登录后可启用邮件摘要并同步设置。" : "Sign in to enable email summaries and sync settings.")}</small></span><button className={user && dailySummaryEnabled ? "active" : ""} disabled={!user} onClick={() => updateUserState((current) => ({ ...current, daily_summary_enabled: !dailySummaryEnabled, notification_preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, ...current.notification_preferences, daily_digest: !dailySummaryEnabled } }))}>{!user ? (zh ? "需登录" : "Sign in") : dailySummaryEnabled ? (zh ? "已开启" : "On") : (zh ? "已关闭" : "Off")}</button></section>
    <section className="notification-settings" id="notifications"><header><span><BellRing size={16} /><span><strong>{zh ? "通知中心与偏好" : "Notification center and preferences"}</strong><small>{zh ? `未读 ${unreadNotifications} 条；提醒按资产和交易日自动去重` : `${unreadNotifications} unread; alerts are deduplicated by asset and market date`}</small></span></span>{unreadNotifications > 0 && <button onClick={markNotificationsRead}><CheckCheck size={14} />{zh ? "全部已读" : "Mark all read"}</button>}</header><div className="notification-preferences">
      <label><span><Bell size={14} /><b>{zh ? "浏览器通知" : "Browser notifications"}</b></span><button className={notificationPreferences.browser_enabled ? "active" : ""} onClick={toggleBrowserNotifications}>{notificationPreferences.browser_enabled ? (zh ? "已开启" : "On") : (zh ? "已关闭" : "Off")}</button></label>
      <label><span><Mail size={14} /><b>{zh ? "邮件提醒" : "Email alerts"}</b></span><button className={notificationPreferences.email_enabled ? "active" : ""} onClick={() => updateNotificationPreference("email_enabled", !notificationPreferences.email_enabled)}>{notificationPreferences.email_enabled ? (zh ? "已开启" : "On") : (zh ? "已关闭" : "Off")}</button></label>
      <label><span><Moon size={14} /><b>{zh ? "免打扰" : "Quiet hours"}</b></span><button className={notificationPreferences.quiet_hours_enabled ? "active" : ""} onClick={() => updateNotificationPreference("quiet_hours_enabled", !notificationPreferences.quiet_hours_enabled)}>{notificationPreferences.quiet_hours_enabled ? (zh ? "已开启" : "On") : (zh ? "已关闭" : "Off")}</button></label>
      <label className="quiet-time"><span>{zh ? "免打扰时段" : "Quiet window"}</span><span><input type="time" value={notificationPreferences.quiet_start} onChange={(event) => updateNotificationPreference("quiet_start", event.target.value)} /><i>—</i><input type="time" value={notificationPreferences.quiet_end} onChange={(event) => updateNotificationPreference("quiet_end", event.target.value)} /></span></label>
      <label className="frequency"><span>{zh ? "同类提醒最短间隔" : "Minimum repeat interval"}</span><select value={notificationPreferences.min_interval_minutes} onChange={(event) => updateNotificationPreference("min_interval_minutes", Number(event.target.value))}><option value={30}>30 {zh ? "分钟" : "min"}</option><option value={60}>1 {zh ? "小时" : "hour"}</option><option value={240}>4 {zh ? "小时" : "hours"}</option><option value={1440}>24 {zh ? "小时" : "hours"}</option></select></label>
    </div>{Boolean(userState.alert_history?.length) && <div className="notification-history">{userState.alert_history!.slice(0, 20).map((item) => <Link className={item.read_at ? "read" : "unread"} href={item.deep_link || assetPath(item.symbol)} key={`${item.id}-${item.triggered_at}`} onClick={() => updateUserState((current) => ({ ...current, alert_history: (current.alert_history || []).map((entry) => entry.id === item.id ? { ...entry, read_at: entry.read_at || new Date().toISOString() } : entry) }))}><span><strong>{item.title || `${item.symbol} · ${alertLabel(item, language)}`}</strong><small>{item.body || `${formatNumber(item.price)} · ${formatPercent(item.change, true)}`}</small></span><time>{new Date(item.triggered_at).toLocaleString(zh ? "zh-CN" : "en-US")}</time></Link>)}</div>}</section>
    <section className="alerts-panel" id="alerts"><header><span><Bell size={15} /><strong>{zh ? "行情与预测提醒" : "Market and forecast alerts"}</strong></span><button className="test-email-button" onClick={sendTestEmail} disabled={!user || testingEmail} title={!user ? (zh ? "登录后可发送测试邮件" : "Sign in to send a test email") : undefined}><Send size={14} />{testingEmail ? (zh ? "发送中" : "Sending") : (zh ? "测试邮件" : "Test email")}</button></header><div className="alert-form"><input value={alertSymbol} onChange={(event) => setAlertSymbol(event.target.value)} placeholder={zh ? "资产代码" : "Symbol"} /><select value={alertType} onChange={(event) => { setAlertType(event.target.value as PriceAlert["type"]); setAlertValue(""); }}><option value="above">{zh ? "高于价格" : "Price above"}</option><option value="below">{zh ? "低于价格" : "Price below"}</option><option value="change">{zh ? "日涨跌幅达到" : "1D move reaches"}</option><option value="signal">{zh ? "预测方向反转" : "Forecast direction reversal"}</option><option value="confidence">{zh ? "可信度变化达到" : "Confidence change reaches"}</option><option value="invalidation">{zh ? "触及预测失效位" : "Forecast invalidation breach"}</option></select>{!["signal", "invalidation"].includes(alertType) && <input type="number" value={alertValue} onChange={(event) => setAlertValue(event.target.value)} placeholder={["change", "confidence"].includes(alertType) ? (zh ? "百分点" : "points") : (zh ? "价格" : "Price")} />}<button onClick={addAlert}><Plus size={14} />{zh ? "添加提醒" : "Add alert"}</button></div><div className="alert-list">{userState.alerts.map((alert) => <article key={alert.id}><span><strong>{alert.symbol}</strong><small>{alertLabel(alert, language)}</small></span><button onClick={() => updateUserState((current) => ({ ...current, alerts: current.alerts.filter((item) => item.id !== alert.id) }))}><Trash2 size={14} /></button></article>)}</div></section>
    </details>
  </main>;
}

function alertLabel(alert: Pick<PriceAlert, "type" | "value">, language: "zh" | "en"): string {
  const zh = language === "zh";
  if (alert.type === "below") return `${zh ? "低于" : "Below"} ${String(alert.value)}`;
  if (alert.type === "change") return `${zh ? "涨跌幅达到" : "Move reaches"} ${String(alert.value)}%`;
  if (alert.type === "signal") return zh ? "预测方向发生反转" : "Forecast direction reverses";
  if (alert.type === "confidence") return `${zh ? "可信度变化达到" : "Confidence changes by"} ${String(alert.value)} ${zh ? "点" : "points"}`;
  if (alert.type === "invalidation") return zh ? "触及预测失效位" : "Forecast invalidation is breached";
  return `${zh ? "高于" : "Above"} ${String(alert.value)}`;
}
