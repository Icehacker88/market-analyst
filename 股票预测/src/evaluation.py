from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score


def evaluate_regression(
    actual_price: pd.Series,
    predicted_price: pd.Series,
    actual_return: pd.Series,
    predicted_return: pd.Series,
) -> dict[str, float]:
    actual_price = pd.Series(actual_price).astype(float)
    predicted_price = pd.Series(predicted_price).astype(float)
    actual_return = pd.Series(actual_return).astype(float)
    predicted_return = pd.Series(predicted_return).astype(float)

    rmse = float(np.sqrt(mean_squared_error(actual_price, predicted_price)))
    mae = float(mean_absolute_error(actual_price, predicted_price))
    mape = float(
        np.mean(np.abs((actual_price - predicted_price) / actual_price.replace(0, np.nan)))
        * 100
    )
    r2 = float(r2_score(actual_price, predicted_price))
    return_rmse = float(np.sqrt(mean_squared_error(actual_return, predicted_return)))
    return_mae = float(mean_absolute_error(actual_return, predicted_return))
    directional_accuracy = float(
        (np.sign(actual_return.to_numpy()) == np.sign(predicted_return.to_numpy())).mean()
        * 100
    )
    return {
        "RMSE": rmse,
        "MAE": mae,
        "MAPE": mape,
        "R2": r2,
        "Return_RMSE": return_rmse,
        "Return_MAE": return_mae,
        "Directional_Accuracy": directional_accuracy,
    }


def build_prediction_frame(
    dates: pd.Series,
    current_price: pd.Series,
    actual_price: pd.Series,
    actual_return: pd.Series,
    predicted_return: pd.Series,
    model_name: str,
) -> pd.DataFrame:
    predicted_price = current_price.astype(float) * np.exp(predicted_return.astype(float))
    frame = pd.DataFrame(
        {
            "Date": pd.to_datetime(dates).dt.date.astype(str),
            "Model": model_name,
            "Current_Price": current_price.to_numpy(),
            "Actual_Price": actual_price.to_numpy(),
            "Predicted_Price": predicted_price.to_numpy(),
            "Actual_Return": actual_return.to_numpy(),
            "Predicted_Return": predicted_return.to_numpy(),
        }
    )
    frame["Actual_Direction"] = np.where(frame["Actual_Return"] >= 0, "Up", "Down")
    frame["Predicted_Direction"] = np.where(frame["Predicted_Return"] >= 0, "Up", "Down")
    frame["Error"] = frame["Actual_Price"] - frame["Predicted_Price"]
    frame["Abs_Error"] = frame["Error"].abs()
    return frame
