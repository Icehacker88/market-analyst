import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ComparisonChart } from "./comparison-chart";
import { Providers } from "./providers";

describe("comparison chart", () => {
  it("shows an empty state when no market data exists", () => {
    render(<Providers><ComparisonChart series={[]} normalized /></Providers>);
    expect(screen.getByText("当前视图暂无可用数据。")).toBeInTheDocument();
  });

  it("keeps every comparison line identifiable by company name and symbol", () => {
    render(<Providers><ComparisonChart
      normalized
      assets={[
        { symbol: "NVDA", name: "NVIDIA Corporation", name_zh: "英伟达", asset_type: "stock", data_source: "yahoo" },
        { symbol: "AAPL", name: "Apple Inc.", name_zh: "苹果", asset_type: "stock", data_source: "yahoo" },
      ]}
      series={[
        { symbol: "NVDA", data_as_of: "2026-07-10", data_source: "yahoo", points: [{ date: "2026-07-10", price: 210, normalized: 100 }] },
        { symbol: "AAPL", data_as_of: "2026-07-10", data_source: "yahoo", points: [{ date: "2026-07-10", price: 315, normalized: 100 }] },
      ]}
    /></Providers>);
    expect(screen.getByText("英伟达")).toBeInTheDocument();
    expect(screen.getByText("NVDA")).toBeInTheDocument();
    expect(screen.getByText("苹果")).toBeInTheDocument();
    expect(screen.getByText("AAPL")).toBeInTheDocument();
  });
});
