import type { Forecast } from "./types";

export type ForecastHorizon = "1D" | "5D" | "10D" | "1M";
export type ForecastPassportState = "validated" | "provisional" | "negative_edge" | "building" | "stale";

export type ForecastPassportRow = {
  horizon: ForecastHorizon;
  model: string | null;
  forecastReturn: number | null;
  forecastPrice: number | null;
  directionShare: number | null;
  validationSamples: number;
  directionEdge: number | null;
  state: ForecastPassportState;
};

const HORIZONS: ForecastHorizon[] = ["1D", "5D", "10D", "1M"];

function forecastValue(forecast: Forecast, horizon: ForecastHorizon): { returnValue: number | null; price: number | null } {
  if (horizon === "1D") return { returnValue: forecast.forecast_1d_return, price: forecast.forecast_1d_price };
  if (horizon === "5D") return { returnValue: forecast.forecast_5d_return, price: forecast.forecast_5d_price };
  if (horizon === "10D") return { returnValue: forecast.forecast_10d_return ?? null, price: forecast.forecast_10d_price ?? null };
  return { returnValue: forecast.forecast_1m_return ?? null, price: forecast.forecast_1m_price ?? null };
}

function stateFor(
  stale: boolean,
  validationSamples: number,
  directionEdge: number | null,
  promoted: boolean,
): ForecastPassportState {
  if (stale) return "stale";
  if (validationSamples < 20 || directionEdge === null) return "building";
  if (directionEdge <= 0) return "negative_edge";
  return promoted ? "validated" : "provisional";
}

export function forecastPassport(forecast: Forecast, marketDate?: string | null): ForecastPassportRow[] {
  const stale = Boolean(marketDate && forecast.data_as_of && forecast.data_as_of < marketDate);
  return HORIZONS.map((horizon) => {
    const model = forecast.horizon_models?.find((item) => item.horizon === horizon);
    const calibration = forecast.horizon_calibration?.[horizon];
    const value = forecastValue(forecast, horizon);
    const validationSamples = model?.validation_samples ?? calibration?.validation_samples ?? 0;
    const directionEdge = model?.direction_edge ?? calibration?.direction_edge ?? null;
    return {
      horizon,
      model: model?.selected_model ?? null,
      forecastReturn: model?.forecast_return ?? value.returnValue,
      forecastPrice: value.price,
      directionShare: model?.direction_probability ?? calibration?.direction_probability ?? null,
      validationSamples,
      directionEdge,
      state: stateFor(stale, validationSamples, directionEdge, Boolean(model?.promoted)),
    };
  });
}
