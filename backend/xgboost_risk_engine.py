# ============================================================================
# ORION PYTHON XGBOOST / RANDOM FOREST RISK EVALUATION ENGINE (`xgboost_risk_engine.py`)
# ----------------------------------------------------------------------------
# Evaluates route risk features against trained XGBoost model and returns
# risk levels (Low, Medium, High, Critical) and route operational decision.
# ============================================================================

from pathlib import Path
import joblib
import pandas as pd

MODEL_PATH = Path("xgboost_risk_level_model.joblib")

ROUTE_DECISION_MAP = {
    "Low": "Yes - route can be used",
    "Medium": "Yes, with caution - monitor the route",
    "High": "Use caution - consider an alternate route",
    "Critical": "No - do not use this route",
}


class XGBoostRiskEngine:
    def __init__(self, model_path: Path = MODEL_PATH):
        if not model_path.exists():
            raise FileNotFoundError(f"Model file not found at {model_path}. Please run `python train_xgboost.py` first.")
        self.artifact = joblib.load(model_path)
        self.model = self.artifact["model"]
        self.label_encoder = self.artifact["label_encoder"]
        self.feature_columns = self.artifact["feature_columns"]

    def evaluate_route(self, route_data: dict) -> dict:
        """
        Evaluates a single route input dictionary against the trained XGBoost model.
        Returns predicted risk level, decision text, and class probabilities.
        """
        # Convert dictionary to DataFrame with required feature columns
        df = pd.DataFrame([route_data])
        for col in self.feature_columns:
            if col not in df.columns:
                df[col] = None

        df = df[self.feature_columns]

        prediction_id = int(self.model.predict(df)[0])
        probabilities = self.model.predict_proba(df)[0]
        predicted_label = str(self.label_encoder.inverse_transform([prediction_id])[0])

        class_probabilities = {
            str(cls): float(prob)
            for cls, prob in zip(self.label_encoder.classes_, probabilities)
        }

        route_decision = ROUTE_DECISION_MAP.get(predicted_label, "Evaluate operational safety")

        return {
            "predicted_risk_level": predicted_label,
            "route_decision": route_decision,
            "class_probabilities": class_probabilities,
            "confidence_pct": round(float(max(probabilities)) * 100, 2),
        }


if __name__ == "__main__":
    print("XGBoost Risk Engine initialized. Run `python test_model.py` to evaluate sample routes.")
