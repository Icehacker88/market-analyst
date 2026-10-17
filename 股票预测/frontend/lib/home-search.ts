import { ASSET_CATALOG } from "./asset-catalog";
import { canonicalizeAsset } from "./assets";
import { searchLocalAssets } from "./local-asset-search";
import type { Asset } from "./types";

const TYPE_WORDS: Record<string, Asset["asset_type"][]> = {
  etf: ["etf"], etfs: ["etf"], 股票: ["stock"], stock: ["stock"], stocks: ["stock"],
  基金: ["fund", "etf"], fund: ["fund", "etf"], funds: ["fund", "etf"],
};

// Whole type words are constraints; never search "etf" inside "Netflix".
// Opted into by the homepage only; other search consumers keep their contract.
export function homeSearchQuery(query: string) {
  const tokens = query.trim().split(/[\s,，/]+/).filter(Boolean);
  const typeFor = (token: string) => Object.hasOwn(TYPE_WORDS, token.toLowerCase()) ? TYPE_WORDS[token.toLowerCase()] : undefined;
  const groups = tokens.map(typeFor).filter((types): types is Asset["asset_type"][] => Boolean(types));
  const types = groups.length ? groups.reduce((a, b) => a.filter((type) => b.includes(type))) : null;
  return { types, text: tokens.filter((token) => !typeFor(token)).join(" ") };
}
export function filterHomeSearchResults(assets: Asset[], query: string): Asset[] {
  const { types } = homeSearchQuery(query);
  return types ? assets.filter((asset) => types.includes(asset.asset_type)) : assets;
}
export function searchHomeAssets(query: string, limit = 30): Asset[] {
  const parsed = homeSearchQuery(query);
  if (!parsed.types) return searchLocalAssets(query, limit);
  const matches = parsed.text ? searchLocalAssets(parsed.text, Number.POSITIVE_INFINITY) : ASSET_CATALOG.map(canonicalizeAsset);
  return filterHomeSearchResults(matches, query).slice(0, limit);
}
