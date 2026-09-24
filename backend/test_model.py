from pathlib import Path
import random

import joblib
import pandas as pd

import generate_dataset
import train_xgboost


DATA_PATH = Path("SIH26002_NER_Complete_20000_Data.csv")
MODEL_PATH = Path("xgboost_risk_level_model.joblib")


def make_random_route(data: pd.DataFrame, feature_columns: list[str]) -> pd.DataFrame:
    randomizer = random.Random(42)
    route = {}
    for column in feature_columns:
        values = data[column].dropna()
        if pd.api.types.is_numeric_dtype(values):
            route[column] = randomizer.uniform(float(values.min()), float(values.max()))
        else:
            route[column] = randomizer.choice(values.astype(str).tolist())
    return pd.DataFrame([route], columns=feature_columns)


def main() -> None:
    if not DATA_PATH.exists():
        print(f"Dataset not found. Generating sample dataset at {DATA_PATH.resolve()}...")
        generate_dataset.generate_sample_dataset()

    if not MODEL_PATH.exists():
        print(f"Model not found. Running training pipeline to build {MODEL_PATH.resolve()}...")
        train_xgboost.main()

    artifact = joblib.load(MODEL_PATH)
    data = pd.read_csv(DATA_PATH)
    sample = make_random_route(data, artifact["feature_columns"])
    prediction_id = int(artifact["model"].predict(sample)[0])
    probabilities = artifact["model"].predict_proba(sample)[0]
    predicted_label = artifact["label_encoder"].inverse_transform([prediction_id])[0]
    route_decision = {
        "Low": "Yes - route can be used",
        "Medium": "Yes, with caution - monitor the route",
        "High": "Use caution - consider an alternate route",
        "Critical": "No - do not use this route",
    }[predicted_label]

    print("\nRandom test route:")
    print(sample.to_string(index=False))
    print(f"\nPredicted risk level: {predicted_label}")
    print(f"Can use this route: {route_decision}")
    print("Class probabilities:")
    for label, probability in zip(artifact["label_encoder"].classes_, probabilities):
        print(f"  {label}: {probability:.2%}")


if __name__ == "__main__":
    main()
