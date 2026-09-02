"use client";

import { Activity, AlertTriangle, Database, LockKeyhole, MousePointerClick, RefreshCw, Server } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ApiError, getMetrics } from "@/lib/api";
import { isAdminUser } from "@/lib/admin";
import { formatNumber } from "@/lib/format";
import type { MetricsSummary } from "@/lib/types";
import { useAuth } from "./auth-provider";
import { useApp } from "./providers";
import { ErrorState, LoadingState } from "./states";

export function MonitorPage() {
  const { language } = useApp();
  const { loading: authLoading, user } = useAuth();
  const [data, setData] = useState<MetricsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const zh = language === "zh";
  const isAdmin = isAdminUser(user);

  function load() {
    if (!isAdmin) return;
    setLoading(true);
    setError(null);
    getMetrics()
      .then(setData)
      .catch((cause) => {
        setData(null);
        setError(cause instanceof ApiError && [401, 403].includes(cause.status) ? (zh ? "只有管理员账号可以查看监控。" : "Only admin accounts can view monitoring.") : (zh ? "监控数据暂时不可用。" : "Monitoring data is temporarily unavailable."));
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    load();
  }, [authLoading, isAdmin]);

  const summary = useMemo(() => summarize(data), [data]);

  return (
    <main className="page-shell monitor-page">
      <header className="page-title">
        <div>
          <h1>{zh ? "运行监控" : "Operations Monitor"}</h1>
          <p>{zh ? "查看接口、缓存和数据源运行状态" : "Track API, cache and data-provider health"}</p>
        </div>
        <button className="primary-link" onClick={load} disabled={loading}>
          <RefreshCw className={loading ? "spin" : ""} size={15} />
          {zh ? "刷新" : "Refresh"}
        </button>
      </header>

      {authLoading || loading ? <LoadingState /> : !isAdmin ? <AdminLocked zh={zh} /> : error ? <ErrorState message={error} retry={load} /> : data && (
        <div className="monitor-stack">
          <section className="monitor-summary">
            <MetricCard icon={<Server size={17} />} label={zh ? "数据源" : "Provider"} value={providerLabel(data.provider, zh)} note={data.paid_provider_ready ? (zh ? "正式数据源已配置" : "Paid provider ready") : (zh ? "当前使用免费云端行情" : "Using free cloud data")} />
            <MetricCard icon={<Activity size={17} />} label={zh ? "今日采样请求" : "Sampled requests"} value={formatNumber(summary.requests, 0)} note={`${zh ? "平均耗时" : "Avg latency"} ${formatNumber(summary.avgMs, 0)} ms · ${formatNumber((data.metric_sample_rate || 1) * 100, 0)}%`} />
            <MetricCard icon={<AlertTriangle size={17} />} label={zh ? "错误率" : "Error rate"} value={`${formatNumber(summary.errorRate, 2)}%`} note={`${summary.errors} / ${summary.requests || 0}`} tone={summary.errorRate > 5 ? "bad" : "ok"} />
            <MetricCard icon={<Database size={17} />} label={zh ? "缓存命中" : "Cache hits"} value={formatNumber(summary.cacheHits, 0)} note={`${zh ? "未命中" : "Misses"} ${summary.cacheMisses} · ${zh ? "过期" : "Stale"} ${summary.cacheStale}`} />
            <MetricCard icon={<RefreshCw size={17} />} label={zh ? "预测任务" : "Forecast job"} value={data.favorite_optimizer ? `${data.favorite_optimizer.succeeded}/${data.favorite_optimizer.processed_symbols}` : "—"} note={data.favorite_optimizer ? `${data.favorite_optimizer.run_date} · ${data.favorite_optimizer.partition || data.favorite_optimizer.trigger}` : (zh ? "尚未运行" : "Not run yet")} tone={data.favorite_optimizer?.failed ? "bad" : "ok"} />
            <MetricCard icon={<MousePointerClick size={17} />} label={zh ? "产品事件" : "Product events"} value={formatNumber(summary.eventTotal, 0)} note={zh ? "匿名、无输入内容" : "Anonymous, no input text"} />
            <MetricCard icon={<Activity size={17} />} label="LCP P75" value={data.web_vitals?.LCP?.p75 === null || data.web_vitals?.LCP?.p75 === undefined ? "—" : `${formatNumber(data.web_vitals.LCP.p75, 0)} ms`} note={zh ? "10% 匿名页面性能采样" : "10% anonymous page sample"} tone={Number(data.web_vitals?.LCP?.p75 || 0) > 2500 ? "bad" : "ok"} />
          </section>

          <section className="monitor-panel">
            <header>
              <strong>{zh ? "匿名产品事件" : "Anonymous product events"}</strong>
              <small>{zh ? "用于发现功能问题，不记录搜索词和对话内容" : "Used for product diagnostics; search text and chats are not recorded"}</small>
            </header>
            <div className="table-wrap"><table><thead><tr><th>{zh ? "事件" : "Event"}</th><th>{zh ? "次数" : "Count"}</th></tr></thead><tbody>
              {summary.eventRows.map((row) => <tr key={row.event}><td>{eventLabel(row.event, zh)}</td><td>{row.count}</td></tr>)}
              {!summary.eventRows.length && <tr><td colSpan={2}>{zh ? "今日暂无产品事件。" : "No product events today."}</td></tr>}
            </tbody></table></div>
          </section>

          <section className="monitor-panel">
            <header>
              <strong>{zh ? "接口请求" : "API requests"}</strong>
              <small>{zh ? "后台采样，展示 P75/P95 尾部延迟" : "Background sample with P75/P95 tail latency"}</small>
            </header>
            <div className="table-wrap">
              <table>
                <thead><tr><th>{zh ? "接口" : "Endpoint"}</th><th>{zh ? "请求" : "Requests"}</th><th>{zh ? "错误" : "Errors"}</th><th>{zh ? "平均" : "Avg"}</th><th>P75</th><th>P95</th><th>{zh ? "状态码" : "Status"}</th></tr></thead>
                <tbody>
                  {summary.requestRows.map((row) => (
                    <tr key={row.endpoint}>
                      <td>{row.endpoint}</td>
                      <td>{row.count}</td>
                      <td className={row.errors ? "negative" : "positive"}>{row.errors}</td>
                      <td>{formatNumber(row.avgMs, 0)}</td>
                      <td>{formatNumber(row.p75Ms, 0)}</td>
                      <td>{formatNumber(row.p95Ms, 0)}</td>
                      <td>{row.statuses}</td>
                    </tr>
                  ))}
                  {!summary.requestRows.length && <tr><td colSpan={7}>{zh ? "今日暂无请求。" : "No requests today."}</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="monitor-panel">
            <header>
              <strong>{zh ? "缓存表现" : "Cache performance"}</strong>
              <small>{zh ? "按访问量排序" : "Sorted by access count"}</small>
            </header>
            <div className="table-wrap">
              <table>
                <thead><tr><th>{zh ? "缓存键" : "Cache key"}</th><th>{zh ? "命中" : "Hit"}</th><th>{zh ? "未命中" : "Miss"}</th><th>{zh ? "过期" : "Stale"}</th><th>{zh ? "失败" : "Error"}</th></tr></thead>
                <tbody>
                  {summary.cacheRows.map((row) => (
                    <tr key={row.key}>
                      <td>{row.key}</td>
                      <td className="positive">{row.hit}</td>
                      <td>{row.miss}</td>
                      <td>{row.stale}</td>
                      <td className={row.error ? "negative" : undefined}>{row.error}</td>
                    </tr>
                  ))}
                  {!summary.cacheRows.length && <tr><td colSpan={5}>{zh ? "今日暂无缓存记录。" : "No cache records today."}</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="monitor-panel">
            <header><strong>{zh ? "真实页面体验" : "Real-user web vitals"}</strong><small>{zh ? "P75 为主要体验基线；CLS 为无单位分数" : "P75 is the primary baseline; CLS is unitless"}</small></header>
            <div className="table-wrap"><table><thead><tr><th>{zh ? "指标" : "Metric"}</th><th>{zh ? "样本" : "Samples"}</th><th>{zh ? "平均" : "Average"}</th><th>P75</th><th>P95</th></tr></thead><tbody>
              {Object.entries(data.web_vitals || {}).map(([name, item]) => <tr key={name}><td>{name}</td><td>{item.count}</td><td>{formatVital(name, item.average)}</td><td>{formatVital(name, item.p75)}</td><td>{formatVital(name, item.p95)}</td></tr>)}
              {!Object.keys(data.web_vitals || {}).length && <tr><td colSpan={5}>{zh ? "尚未积累页面性能样本。" : "No real-user samples yet."}</td></tr>}
            </tbody></table></div>
          </section>

          <section className="monitor-panel">
            <header>
              <strong>{zh ? "核心预测冻结与收藏深度优化" : "Core forecast freeze and favorite deep tuning"}</strong>
              <small>{zh ? "每天 08:15、08:45 分批运行并处理提醒" : "Runs in partitions at 08:15 and 08:45 China time, then processes alerts"}</small>
            </header>
            {data.favorite_optimizer ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>{zh ? "股票" : "Symbol"}</th><th>{zh ? "状态" : "Status"}</th><th>{zh ? "说明" : "Message"}</th></tr></thead>
                  <tbody>
                    {data.favorite_optimizer.symbols.map((item) => (
                      <tr key={item.symbol}>
                        <td>{item.symbol}</td>
                        <td className={item.status === "ok" ? "positive" : "negative"}>{item.status === "ok" ? (zh ? "成功" : "OK") : (zh ? "失败" : "Error")}</td>
                        <td>{item.message || "—"}</td>
                      </tr>
                    ))}
                    {!data.favorite_optimizer.symbols.length && <tr><td colSpan={3}>{zh ? "云端收藏为空，暂无需要优化的股票。" : "No cloud favorites to optimize yet."}</td></tr>}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="monitor-note">{zh ? "尚未产生运行记录。登录后收藏股票并完成云端同步，下一次定时任务会自动优化。" : "No run record yet. Sign in, save favorites, and the next scheduled run will optimize them."}</p>
            )}
          </section>

          <p className="monitor-note">
            {zh ? "更新时间" : "Updated"} {new Date(data.updated_at).toLocaleString(zh ? "zh-CN" : "en-US")} · {zh ? "统计日期" : "Date"} {data.date}
          </p>
        </div>
      )}
    </main>
  );
}

function AdminLocked({ zh }: { zh: boolean }) {
  return <section className="admin-locked"><LockKeyhole size={20} /><strong>{zh ? "仅管理员可见" : "Admin only"}</strong><p>{zh ? "请使用管理员账号登录后查看运行监控。" : "Sign in with the admin account to view operations monitoring."}</p></section>;
}

function MetricCard({ icon, label, value, note, tone }: { icon: React.ReactNode; label: string; value: string; note: string; tone?: "ok" | "bad" }) {
  return <article className={`monitor-card ${tone || ""}`}><span>{icon}</span><small>{label}</small><strong>{value}</strong><em>{note}</em></article>;
}

function summarize(data: MetricsSummary | null) {
  const requestRows = Object.entries(data?.requests || {}).map(([endpoint, item]) => ({
    endpoint,
    count: item.count,
    errors: item.errors,
    avgMs: item.count ? item.total_ms / item.count : 0,
    p75Ms: item.p75_ms ?? null,
    p95Ms: item.p95_ms ?? null,
    statuses: Object.entries(item.statuses).map(([status, count]) => `${status}:${count}`).join(" "),
  })).sort((a, b) => b.count - a.count);
  const cacheRows = Object.entries(data?.cache || {}).map(([key, item]) => ({
    key,
    ...item,
    total: item.hit + item.miss + item.stale + item.error,
  })).sort((a, b) => b.total - a.total);
  const eventRows = Object.entries(data?.events || {}).map(([event, count]) => ({ event, count })).sort((a, b) => b.count - a.count);
  const requests = requestRows.reduce((sum, row) => sum + row.count, 0);
  const errors = requestRows.reduce((sum, row) => sum + row.errors, 0);
  const totalMs = Object.values(data?.requests || {}).reduce((sum, item) => sum + item.total_ms, 0);
  return {
    requests,
    errors,
    errorRate: requests ? (errors / requests) * 100 : 0,
    avgMs: requests ? totalMs / requests : 0,
    cacheHits: cacheRows.reduce((sum, row) => sum + row.hit, 0),
    cacheMisses: cacheRows.reduce((sum, row) => sum + row.miss, 0),
    cacheStale: cacheRows.reduce((sum, row) => sum + row.stale, 0),
    eventTotal: eventRows.reduce((sum, row) => sum + row.count, 0),
    eventRows,
    requestRows: requestRows.slice(0, 30),
    cacheRows: cacheRows.slice(0, 30),
  };
}

function eventLabel(event: string, zh: boolean): string {
  const labels: Record<string, [string, string]> = {
    search: ["搜索结果打开", "Search result opened"], asset_view: ["资产分析打开", "Asset analysis opened"], favorite_add: ["新增收藏", "Favorite added"], favorite_remove: ["取消收藏", "Favorite removed"], alert_create: ["创建提醒", "Alert created"], login: ["登录成功", "Login success"], ai_question: ["AI 追问", "AI question"],
    forecast_view: ["预测页查看", "Forecast viewed"], forecast_evidence_open: ["预测凭证展开", "Forecast evidence opened"], recommendation_open: ["研究候选打开", "Recommendation opened"], track_record_view: ["预测成绩查看", "Track record viewed"], comparison_view: ["多资产对比", "Comparison viewed"], watchlist_view: ["我的研究查看", "Watchlist viewed"], portfolio_view: ["组合查看", "Portfolio viewed"], screener_save: ["保存选股条件", "Screener saved"],
  };
  return labels[event]?.[zh ? 0 : 1] || event;
}

function providerLabel(provider: string, zh: boolean): string {
  if (provider === "free-yahoo-eastmoney") return zh ? "免费行情" : "Free data";
  return provider;
}

function formatVital(name: string, value?: number | null): string {
  if (value === null || value === undefined) return "—";
  return name === "CLS" ? formatNumber(value, 3) : `${formatNumber(value, 0)} ms`;
}
