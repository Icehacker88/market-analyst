"use client";

import { formatPercent } from "@/lib/format";
import { RANGE_OPTIONS } from "@/lib/periods";
import { useApp } from "./providers";

export function PeriodReturnStrip({
  returns,
  range,
  onChange,
}: {
  returns?: Record<string, number | null>;
  range: string;
  onChange: (range: string) => void;
}) {
  const { t } = useApp();

  return (
    <div className="period-return-strip">
      {RANGE_OPTIONS.map((item) => {
        const value = returns?.[item.range] ?? null;
        return (
          <button key={item.range} className={range === item.range ? "active" : ""} onClick={() => onChange(item.range)}>
            <span>{t(item.label)}</span>
            <strong className={typeof value === "number" ? value > 0 ? "positive" : value < 0 ? "negative" : "" : ""}>{formatPercent(value, true)}</strong>
          </button>
        );
      })}
    </div>
  );
}
