from pathlib import Path
import joblib
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, LabelEncoder
from sklearn.utils.class_weight import compute_sample_weight
from xgboost import XGBClassifier


DATA_PATH = Path("SIH26002_NER_Complete_20000_Data.csv")
MODEL_PATH = Path("xgboost_risk_level_model.joblib")
TARGET = "risk_level"

DROP_COLUMNS = {
    TARGET, "data_id", "road_id", "vehicle_id", "field_report_id", "photo_path",
    "route_recommendation", "alternate_route", "alternate_distance_km",
    "alternate_eta_min", "route_pair",
}


def build_pipeline(n_classes: int) -> Pipeline:
    numeric_columns = [
        "origin_lat", "origin_lon", "destination_lat", "destination_lon", "distance_km",
        "slope_deg", "elevation_m", "rainfall_mm_24h", "temperature_c", "humidity_pct",
        "wind_speed_kmph", "soil_moisture_pct", "forecast_disruption_risk_pct",
        "past_landslides_12m", "past_floods_12m", "accidents_12m", "bridge_capacity_tonnes",
        "congestion_index", "traffic_volume_vph", "vehicle_speed_kmph", "travel_time_hr",
        "eta_min", "delay_min", "cargo_quantity_units", "current_stock_units",
        "daily_consumption_units", "forecast_3day_demand_units", "shortage_flag", "weather_risk",
        "terrain_risk", "road_condition_risk", "incident_risk", "traffic_risk", "historical_risk",
        "dynamic_risk_score", "accessibility_score", "earthquake_magnitude", "earthquake_depth_km",
        "pga_g", "pgv_cm_s", "wave_amplitude_mm", "dominant_frequency_hz", "ground_displacement_cm",
        "wave_arrival_time_sec", "route_safety_index", "stock_days_remaining", "estimated_fuel_liters",
        "delivery_urgency_score", "combined_transport_risk",
    ]
    categorical_columns = [
        "origin", "origin_state", "destination", "destination_state", "road_type", "road_condition",
        "weather_condition", "incident_type", "incident_severity", "cargo_type", "supply_priority",
        "bridge_condition", "earthquake_transport_impact", "verification_status",
    ]
    numeric = Pipeline([("imputer", SimpleImputer(strategy="median"))])
    categorical = Pipeline([
        ("imputer", SimpleImputer(strategy="most_frequent")),
        ("onehot", OneHotEncoder(handle_unknown="ignore")),
    ])
    preprocess = ColumnTransformer([
        ("numeric", numeric, numeric_columns),
        ("categorical", categorical, categorical_columns),
    ])
    classifier = XGBClassifier(
        objective="multi:softprob", num_class=n_classes, n_estimators=350, max_depth=6,
        learning_rate=0.08, subsample=0.85, colsample_bytree=0.85, eval_metric="mlogloss",
        tree_method="hist", random_state=42, n_jobs=-1,
    )
    return Pipeline([("preprocess", preprocess), ("classifier", classifier)])


def main() -> None:
    if not DATA_PATH.exists():
        raise FileNotFoundError(f"Dataset not found: {DATA_PATH.resolve()}")
    data = pd.read_csv(DATA_PATH).dropna(subset=[TARGET])
    features = data.drop(columns=[c for c in DROP_COLUMNS if c in data.columns])
    labels = LabelEncoder()
    target = labels.fit_transform(data[TARGET])
    x_train, x_test, y_train, y_test = train_test_split(
        features, target, test_size=0.2, random_state=42, stratify=target,
    )
    model = build_pipeline(n_classes=len(labels.classes_))
    sample_weights = compute_sample_weight(class_weight="balanced", y=y_train)
    model.fit(x_train, y_train, classifier__sample_weight=sample_weights)
    predictions = model.predict(x_test)

    if hasattr(predictions, "ndim") and predictions.ndim > 1:
        predictions = predictions.argmax(axis=1)

    class_ids = list(range(len(labels.classes_)))
    print(f"Rows: {len(data):,} | Features: {features.shape[1]} | Classes: {list(labels.classes_)}")
    print("\nClassification report:\n")
    print(classification_report(y_test, predictions, labels=class_ids,
                                target_names=labels.classes_, zero_division=0))
    print("Confusion matrix (rows=true, columns=predicted):")
    print(confusion_matrix(y_test, predictions, labels=class_ids))
    joblib.dump({"model": model, "label_encoder": labels,
                 "feature_columns": list(features.columns)}, MODEL_PATH)
    print(f"\nSaved XGBoost model to: {MODEL_PATH.resolve()}")


if __name__ == "__main__":
    main()
