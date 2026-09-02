"use client";

import { CandlestickChart, Download, Expand, LineChart as LineChartIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ECharts, EChartsOption } from "echarts";
import type { History } from "@/lib/types";
import { useApp } from "./providers";

export function AdvancedMarketChart({ history }: { history: History }) {
  const { language, theme } = useApp();
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ECharts | null>(null);
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<"candles" | "line">("candles");
  const [showVolume, setShowVolume] = useState(true);
  const [showMA, setShowMA] = useState(true);
  const [indicator, setIndicator] = useState<"none" | "rsi" | "macd">("none");

  useEffect(() => {
    if (!host.current || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "320px 0px" });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [history.symbol]);

  useEffect(() => {
    if (!visible || !host.current || !history.records.length) return;
    let disposed = false;
    let resize: ResizeObserver | null = null;
    const styles = getComputedStyle(document.documentElement);
    const rows = history.records.filter((row) => Number.isFinite(Number(row.Price)));

    async function render() {
      const { echarts } = await import("@/lib/echarts-runtime");
      if (!host.current || disposed) return;
      const chart = echarts.init(host.current, theme === "dark" ? "dark" : undefined, { renderer: "canvas" });
      chartRef.current = chart;
      chart.setOption(buildOption({
        rows,
        language,
        mode,
        indicator,
        showMA,
        showVolume,
        textColor: styles.getPropertyValue("--muted").trim() || "#6b706d",
        gridColor: styles.getPropertyValue("--grid").trim() || "#dedbd3",
        borderColor: styles.getPropertyValue("--border").trim() || "#d8d5cd",
        surfaceColor: styles.getPropertyValue("--surface").trim() || "#fbfaf7",
      }));
      resize = new ResizeObserver(() => chart.resize());
      resize.observe(host.current);
    }

    render();
    return () => {
      disposed = true;
      resize?.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [history, indicator, language, mode, showMA, showVolume, theme, visible]);

  function download() {
    const dataUrl = chartRef.current?.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: theme === "dark" ? "#161b18" : "#fbfaf7" });
    if (!dataUrl) return;
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `${history.symbol}-chart.png`;
    link.click();
  }

  return <section className="advanced-chart-card">
    <header><strong>{language === "zh" ? "交互行情图" : "Interactive chart"}</strong><div className="chart-tools">
      <button className={mode === "candles" ? "active" : ""} onClick={() => setMode("candles")}><CandlestickChart size={14} />{language === "zh" ? "K 线" : "Candles"}</button>
      <button className={mode === "line" ? "active" : ""} onClick={() => setMode("line")}><LineChartIcon size={14} />{language === "zh" ? "折线" : "Line"}</button>
      <button className={showVolume ? "active" : ""} onClick={() => setShowVolume((value) => !value)}>{language === "zh" ? "成交量" : "Volume"}</button>
      <button className={showMA ? "active" : ""} onClick={() => setShowMA((value) => !value)}>MA20/50</button>
      <button className={indicator === "rsi" ? "active" : ""} onClick={() => setIndicator((value) => value === "rsi" ? "none" : "rsi")}>RSI</button>
      <button className={indicator === "macd" ? "active" : ""} onClick={() => setIndicator((value) => value === "macd" ? "none" : "macd")}>MACD</button>
      <button onClick={() => host.current?.parentElement?.requestFullscreen()} title={language === "zh" ? "全屏" : "Fullscreen"}><Expand size={14} /></button>
      <button onClick={download} title={language === "zh" ? "下载图片" : "Download image"}><Download size={14} /></button>
    </div></header>
    <div ref={host} className="advanced-chart-host">{!visible ? <span className="chart-lazy-placeholder">{language === "zh" ? "图表将在进入可视区域后加载" : "Chart loads when it enters view"}</span> : null}</div>
  </section>;
}

type ChartRow = History["records"][number];

function buildOption({
  rows,
  language,
  mode,
  indicator,
  showMA,
  showVolume,
  textColor,
  gridColor,
  borderColor,
  surfaceColor,
}: {
  rows: ChartRow[];
  language: "zh" | "en";
  mode: "candles" | "line";
  indicator: "none" | "rsi" | "macd";
  showMA: boolean;
  showVolume: boolean;
  textColor: string;
  gridColor: string;
  borderColor: string;
  surfaceColor: string;
}): EChartsOption {
  const dates = rows.map((row) => String(row.Date));
  const priceLine = rows.map((row) => Number(row.Price));
  const candles = rows.map((row) => [
    Number(row.Open ?? row.Price),
    Number(row.Close ?? row.Price),
    Number(row.Low ?? row.Price),
    Number(row.High ?? row.Price),
  ]);
  const ma20 = rows.map((row) => row.MA_20 === null || row.MA_20 === undefined ? null : Number(row.MA_20));
  const ma50 = rows.map((row) => row.MA_50 === null || row.MA_50 === undefined ? null : Number(row.MA_50));
  const rsi14 = rows.map((row) => row.RSI_14 === null || row.RSI_14 === undefined ? null : Number(row.RSI_14));
  const macd = rows.map((row) => row.MACD === null || row.MACD === undefined ? null : Number(row.MACD));
  const macdSignal = rows.map((row) => row.MACD_Signal === null || row.MACD_Signal === undefined ? null : Number(row.MACD_Signal));
  const macdHist = rows.map((row) => ({
    value: row.MACD_Hist === null || row.MACD_Hist === undefined ? null : Number(row.MACD_Hist),
    itemStyle: { color: Number(row.MACD_Hist ?? 0) >= 0 ? "rgba(19,133,111,.45)" : "rgba(223,81,72,.42)" },
  }));
  const showIndicator = indicator !== "none";
  const xAxisIndexes = [0];
  const grids: Array<Record<string, unknown>> = [{ left: 8, right: 46, top: 28, height: showVolume || showIndicator ? "58%" : undefined, bottom: showVolume || showIndicator ? undefined : 42 }];
  const xAxis: Array<Record<string, unknown>> = [axis(dates, gridColor, borderColor, textColor)];
  const yAxis: Array<Record<string, unknown>> = [priceAxis(gridColor, borderColor, textColor)];
  let gridIndex = 1;
  let volumeAxisIndex: number | null = null;
  let indicatorAxisIndex: number | null = null;
  if (showVolume) {
    volumeAxisIndex = gridIndex;
    xAxisIndexes.push(gridIndex);
    grids.push({ left: 8, right: 46, top: showIndicator ? "69%" : "78%", height: "10%" });
    xAxis.push({ ...axis(dates, gridColor, borderColor, textColor), gridIndex, axisLabel: { show: false }, axisTick: { show: false } });
    yAxis.push({ type: "value", gridIndex, splitNumber: 2, axisLabel: { show: false }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false } });
    gridIndex += 1;
  }
  if (showIndicator) {
    indicatorAxisIndex = gridIndex;
    xAxisIndexes.push(gridIndex);
    grids.push({ left: 8, right: 46, top: showVolume ? "82%" : "74%", height: showVolume ? "12%" : "18%" });
    xAxis.push({ ...axis(dates, gridColor, borderColor, textColor), gridIndex });
    yAxis.push(indicator === "rsi" ? rsiAxis(gridIndex, gridColor, borderColor, textColor) : macdAxis(gridIndex, gridColor, borderColor, textColor));
  }
  const volume = rows.map((row, index) => ({
    value: Number(row.Volume ?? 0),
    itemStyle: { color: Number(row.Price) >= Number(rows[Math.max(0, index - 1)]?.Price) ? "rgba(19,133,111,.32)" : "rgba(223,81,72,.28)" },
  }));
  const series: Array<Record<string, unknown>> = [mode === "candles" ? {
    name: language === "zh" ? "价格" : "Price",
    type: "candlestick",
    data: candles,
    yAxisIndex: 0,
    xAxisIndex: 0,
    itemStyle: { color: "#13856f", color0: "#df5148", borderColor: "#13856f", borderColor0: "#df5148" },
  } : {
    name: language === "zh" ? "价格" : "Price",
    type: "line",
    data: priceLine,
    yAxisIndex: 0,
    xAxisIndex: 0,
    smooth: true,
    showSymbol: false,
    lineStyle: { color: "#117a72", width: 2 },
  }];
  if (showMA) {
    series.push(
      { name: "MA20", type: "line", data: ma20, showSymbol: false, smooth: true, lineStyle: { color: "#d08c2d", width: 1.2 } },
      { name: "MA50", type: "line", data: ma50, showSymbol: false, smooth: true, lineStyle: { color: "#7c69a8", width: 1.2 } },
    );
  }
  if (showVolume) {
    series.push({ name: language === "zh" ? "成交量" : "Volume", type: "bar", data: volume, xAxisIndex: volumeAxisIndex, yAxisIndex: volumeAxisIndex, barWidth: "58%" });
  }
  if (indicator === "rsi" && indicatorAxisIndex !== null) {
    series.push({
      name: "RSI14",
      type: "line",
      data: rsi14,
      xAxisIndex: indicatorAxisIndex,
      yAxisIndex: indicatorAxisIndex,
      showSymbol: false,
      smooth: true,
      lineStyle: { color: "#b07a23", width: 1.3 },
      markLine: { symbol: "none", silent: true, data: [{ yAxis: 70 }, { yAxis: 30 }], lineStyle: { color: gridColor, type: "dashed" } },
    });
  }
  if (indicator === "macd" && indicatorAxisIndex !== null) {
    series.push(
      { name: "MACD Hist", type: "bar", data: macdHist, xAxisIndex: indicatorAxisIndex, yAxisIndex: indicatorAxisIndex, barWidth: "58%" },
      { name: "MACD", type: "line", data: macd, xAxisIndex: indicatorAxisIndex, yAxisIndex: indicatorAxisIndex, showSymbol: false, lineStyle: { color: "#117a72", width: 1.1 } },
      { name: "Signal", type: "line", data: macdSignal, xAxisIndex: indicatorAxisIndex, yAxisIndex: indicatorAxisIndex, showSymbol: false, lineStyle: { color: "#d08c2d", width: 1.1 } },
    );
  }
  return {
    backgroundColor: "transparent",
    animation: false,
    color: ["#117a72", "#d08c2d", "#7c69a8"],
    textStyle: { color: textColor, fontFamily: "Inter, ui-sans-serif, system-ui" },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross", link: [{ xAxisIndex: xAxisIndexes }], label: { backgroundColor: "#117a72" } },
      backgroundColor: surfaceColor,
      borderColor,
      textStyle: { color: textColor },
    },
    legend: { top: 0, right: 8, textStyle: { color: textColor, fontSize: 10 } },
    grid: grids,
    xAxis,
    yAxis,
    dataZoom: [
      { type: "inside", xAxisIndex: xAxisIndexes, start: 0, end: 100 },
      { type: "slider", xAxisIndex: xAxisIndexes, height: 18, bottom: 4, borderColor, fillerColor: "rgba(17,122,114,.14)", handleStyle: { color: "#117a72" }, textStyle: { color: textColor } },
    ],
    series: series as EChartsOption["series"],
  };
}

function axis(dates: string[], gridColor: string, borderColor: string, textColor: string) {
  return {
    type: "category" as const,
    data: dates,
    boundaryGap: false,
    axisLine: { lineStyle: { color: borderColor } },
    axisTick: { show: false },
    axisLabel: { color: textColor, fontSize: 10 },
    splitLine: { show: true, lineStyle: { color: gridColor } },
  };
}

function priceAxis(gridColor: string, borderColor: string, textColor: string) {
  return {
    type: "value" as const,
    scale: true,
    position: "right" as const,
    axisLine: { lineStyle: { color: borderColor } },
    axisLabel: { color: textColor, fontSize: 10 },
    splitLine: { lineStyle: { color: gridColor } },
  };
}

function rsiAxis(gridIndex: number, gridColor: string, borderColor: string, textColor: string) {
  return {
    type: "value" as const,
    gridIndex,
    min: 0,
    max: 100,
    splitNumber: 2,
    position: "right" as const,
    axisLine: { lineStyle: { color: borderColor } },
    axisLabel: { color: textColor, fontSize: 10 },
    splitLine: { lineStyle: { color: gridColor } },
  };
}

function macdAxis(gridIndex: number, gridColor: string, borderColor: string, textColor: string) {
  return {
    type: "value" as const,
    gridIndex,
    scale: true,
    position: "right" as const,
    axisLine: { lineStyle: { color: borderColor } },
    axisLabel: { color: textColor, fontSize: 10 },
    splitLine: { lineStyle: { color: gridColor } },
  };
}
