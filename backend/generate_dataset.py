import random
from pathlib import Path
import pandas as pd

DATA_PATH = Path("SIH26002_NER_Complete_20000_Data.csv")

def generate_sample_dataset(num_rows=800):
    randomizer = random.Random(42)
    records = []

    road_types = ["National Highway", "State Highway", "District Road", "Rural Road"]
    road_conditions = ["open", "at_risk", "blocked"]
    weather_conditions = ["clear", "rain", "heavy_rain", "storm"]
    incident_types = ["none", "landslide", "pothole", "accident", "flood"]
    incident_severities = ["low", "moderate", "high", "critical"]

    for i in range(num_rows):
        slope = randomizer.uniform(2.0, 40.0)
        rain = randomizer.uniform(0.0, 180.0)
        landslides = randomizer.randint(0, 5)
        floods = randomizer.randint(0, 4)
        accidents = randomizer.randint(0, 10)
        pga = randomizer.uniform(0.02, 0.40)
        eq_mag = randomizer.uniform(2.5, 6.5)

        # Force uniform distribution across all 4 classes
        risk = ["Low", "Medium", "High", "Critical"][i % 4]

        record = {
            "data_id": f"DATA_{i+1:05d}",
            "road_id": f"ROAD_{randomizer.randint(100, 999)}",
            "vehicle_id": f"VEH_{randomizer.randint(1000, 9999)}",
            "origin": "Guwahati",
            "origin_state": "Assam",
            "destination": "Shillong",
            "destination_state": "Meghalaya",
            "origin_lat": randomizer.uniform(25.5, 26.5),
            "origin_lon": randomizer.uniform(91.0, 92.5),
            "destination_lat": randomizer.uniform(25.0, 26.0),
            "destination_lon": randomizer.uniform(91.5, 92.8),
            "distance_km": randomizer.uniform(20.0, 250.0),
            "slope_deg": slope,
            "elevation_m": randomizer.uniform(100.0, 1800.0),
            "rainfall_mm_24h": rain,
            "temperature_c": randomizer.uniform(10.0, 35.0),
            "humidity_pct": randomizer.uniform(50.0, 95.0),
            "wind_speed_kmph": randomizer.uniform(5.0, 60.0),
            "soil_moisture_pct": randomizer.uniform(20.0, 90.0),
            "forecast_disruption_risk_pct": randomizer.uniform(10.0, 90.0),
            "past_landslides_12m": landslides,
            "past_floods_12m": floods,
            "accidents_12m": accidents,
            "bridge_capacity_tonnes": randomizer.uniform(15.0, 50.0),
            "congestion_index": randomizer.uniform(0.1, 0.9),
            "traffic_volume_vph": randomizer.randint(100, 1800),
            "vehicle_speed_kmph": randomizer.uniform(20.0, 70.0),
            "travel_time_hr": randomizer.uniform(0.5, 6.0),
            "eta_min": randomizer.randint(30, 360),
            "delay_min": randomizer.randint(0, 90),
            "cargo_quantity_units": randomizer.randint(200, 4000),
            "current_stock_units": randomizer.randint(1000, 15000),
            "daily_consumption_units": randomizer.randint(300, 2000),
            "forecast_3day_demand_units": randomizer.randint(900, 6000),
            "shortage_flag": randomizer.choice([0, 1]),
            "weather_risk": randomizer.uniform(0.1, 0.9),
            "terrain_risk": randomizer.uniform(0.1, 0.9),
            "road_condition_risk": randomizer.uniform(0.1, 0.9),
            "incident_risk": randomizer.uniform(0.1, 0.9),
            "traffic_risk": randomizer.uniform(0.1, 0.9),
            "historical_risk": randomizer.uniform(0.1, 0.9),
            "dynamic_risk_score": randomizer.uniform(15.0, 85.0),
            "accessibility_score": randomizer.uniform(0.2, 0.95),
            "earthquake_magnitude": eq_mag,
            "earthquake_depth_km": randomizer.uniform(10.0, 50.0),
            "pga_g": pga,
            "pgv_cm_s": randomizer.uniform(1.0, 20.0),
            "wave_amplitude_mm": randomizer.uniform(0.2, 10.0),
            "dominant_frequency_hz": randomizer.uniform(1.0, 10.0),
            "ground_displacement_cm": randomizer.uniform(0.0, 5.0),
            "wave_arrival_time_sec": randomizer.uniform(5.0, 30.0),
            "route_safety_index": randomizer.uniform(0.2, 0.9),
            "stock_days_remaining": randomizer.uniform(1.0, 10.0),
            "estimated_fuel_liters": randomizer.uniform(25.0, 250.0),
            "delivery_urgency_score": randomizer.uniform(0.2, 0.9),
            "combined_transport_risk": randomizer.uniform(10.0, 90.0),
            "road_type": randomizer.choice(road_types),
            "road_condition": randomizer.choice(road_conditions),
            "weather_condition": randomizer.choice(weather_conditions),
            "incident_type": randomizer.choice(incident_types),
            "incident_severity": randomizer.choice(incident_severities),
            "cargo_type": "essential_goods",
            "supply_priority": "high",
            "bridge_condition": "good",
            "earthquake_transport_impact": "low",
            "verification_status": "verified",
            "risk_level": risk,
        }
        records.append(record)

    df = pd.DataFrame(records)
    df.to_csv(DATA_PATH, index=False)
    print(f"Generated dataset file: {DATA_PATH.resolve()} ({len(df)} rows)")

if __name__ == "__main__":
    generate_sample_dataset()
