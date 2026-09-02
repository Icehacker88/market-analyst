"use client";

import { useEffect, useRef, useState } from "react";
import type { ECharts, EChartsOption } from "echarts";
import { useApp } from "./providers";

export type UnifiedLineSeries = {
  key: string;
  name: string;
  color: string;
  dashed?: boolean;
};

export function UnifiedLineChart({
  rows,
  xKey,
  series,
  height = 330,
  percent = false,
  domain,
  showLegend = false,
}: {
  rows: Array<Record<string, string | number | null | undefined>>;
  xKey: string;
  series: UnifiedLineSeries[];
  height?: number;
  percent?: boolean;
  domain?: [number | "dataMin", number | "dataMax"];
  showLegend?: boolean;
}) {
  const { language, theme } = useApp();
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ECharts | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!host.current || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "260px 0px" });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [rows]);

  useEffect(() => {
    if (process.env.NODE_ENV === "test" || !visible || !host.current || !rows.length) return;
    let disposed = false;
    let resize: ResizeObserver | null = null;
    const styles = getComputedStyle(document.documentElement);
    const textColor = styles.getPropertyValue("--muted").trim() || "#6b706d";
    const gridColor = styles.getPropertyValue("--grid").trim() || "#dedbd3";
    const surface = styles.getPropertyValue("--surface").trim() || "#fbfaf7";

    async function render() {
      const { echarts } = await import("@/lib/echarts-runtime");
      if (!host.current || disposed) return;
      const chart = echarts.init(host.current, theme === "dark" ? "dark" : undefined, { renderer: "canvas" });
      chartRef.current = chart;
      const option: EChartsOption = {
        animationDuration: 280,
        backgroundColor: "transparent",
        color: series.map((item) => item.color),
        grid: { left: 9, right: 18, top: showLegend ? 40 : 20, bottom: 34, containLabel: true },
        legend: showLegend ? { top: 5, textStyle: { color: textColor, fontSize: 10 } } : { show: false },
        tooltip: {
          trigger: "axis",
          backgroundColor: surface,
          borderColor: gridColor,
          textStyle: { color: textColor, fontSize: 11 },
          valueFormatter: (value) => `${Number(value).toFixed(percent ? 2 : 2)}${percent ? "%" : ""}`,
        },
        xAxis: {
          type: "category",
          boundaryGap: false,
          data: rows.map((row) => String(row[xKey] ?? "")),
          axisLine: { lineStyle: { color: gridColor } },
          axisTick: { show: false },
          axisLabel: { color: textColor, fontSize: 10, hideOverlap: true },
        },
        yAxis: {
          type: "value",
          ...(domain ? { min: domain[0], max: domain[1] } : { scale: true }),
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: textColor, fontSize: 10, formatter: (value: number) => `${value.toFixed(percent ? 1 : 0)}${percent ? "%" : ""}` },
          splitLine: { lineStyle: { color: gridColor, type: "dashed" } },
        },
        series: series.map((item) => ({
          name: item.name,
          type: "line",
          data: rows.map((row) => {
            const value = Number(row[item.key]);
            return Number.isFinite(value) ? value : null;
          }),
          showSymbol: false,
          connectNulls: true,
          smooth: 0.12,
          lineStyle: { width: 2.2, color: item.color, type: item.dashed ? "dashed" : "solid" },
          itemStyle: { color: item.color },
          emphasis: { focus: "series" },
        })),
      };
      chart.setOption(option);
      if (typeof ResizeObserver !== "undefined") {
        resize = new ResizeObserver(() => chart.resize());
        resize.observe(host.current);
      }
    }

    void render();
    return () => {
      disposed = true;
      resize?.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [domain, height, percent, rows, series, showLegend, theme, visible, xKey]);

  return <div ref={host} className="unified-line-chart" style={{ height }}>{!visible ? <span className="chart-lazy-placeholder">{language === "zh" ? "图表将在进入可视区域后加载" : "Chart loads when it enters view"}</span> : null}</div>;
}
