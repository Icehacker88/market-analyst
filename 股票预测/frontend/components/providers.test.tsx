import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Asset } from "@/lib/types";
import { Providers, useApp } from "./providers";

const spy: Asset = {
  symbol: "SPY",
  name: "SPDR S&P 500 ETF Trust",
  asset_type: "etf",
  data_source: "yahoo",
};

function Probe() {
  const app = useApp();
  return <div>
    <span data-testid="theme">{app.theme}</span>
    <span data-testid="language">{app.language}</span>
    <span data-testid="favorites">{app.favorites.length}</span>
    <button onClick={app.toggleTheme}>theme</button>
    <button onClick={app.toggleLanguage}>language</button>
    <button onClick={() => app.toggleFavorite(spy)}>favorite</button>
  </div>;
}

describe("persisted preferences", () => {
  it("switches dark mode, language and favorites", () => {
    localStorage.clear();
    render(<Providers><Probe /></Providers>);
    fireEvent.click(screen.getByText("theme"));
    fireEvent.click(screen.getByText("language"));
    fireEvent.click(screen.getByText("favorite"));
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    expect(screen.getByTestId("language")).toHaveTextContent("en");
    expect(screen.getByTestId("favorites")).toHaveTextContent("1");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
