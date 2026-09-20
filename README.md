# Oil Spill Investigation Platform
 
> **Team Daemon** <br>
> Smart India Hackathon 2026 | Problem Statement ID: 26143 <br>
> Organisation: National Technical Research Organisation (NTRO) | Category: Software | Theme: Space Technology
 
A prototype platform for detecting oil spills from SAR satellite imagery, reconstructing the spill origin via drift modeling, and attributing responsibility to candidate vessels using AIS vessel-tracking data.
 
---
 
## Table of Contents
 
1. [Problem Statement](#problem-statement)
2. [Solution Overview](#solution-overview)
3. [Screenshots](#screenshots)
4. [Architecture](#architecture)
5. [Tech Stack](#tech-stack)
6. [Quick Start](#quick-start)
7. [Usage Guide](#usage-guide)
8. [API Endpoints](#api-endpoints)
9. [Data Sources & Limitations](#data-sources--limitations)
10. [Testing](#testing)
11. [License](#license)
---
 
## Problem Statement
 
**Title:** Leveraging satellite imagery to determine oil spills at sea along with AIS data correlations to identify the vessel responsible for the spill.
 
**Background:** Marine oil spills inflict great damage on marine ecosystems and, several times, remain un-attributable to the vessel causing such spills. Leveraging satellite imagery along with AIS data will enable detection of oil spills and the vessel responsible for the same.
 
**Description:** The core challenge is to facilitate detection of oil spills and identification of the polluting vessel using remote sensing satellite data — such as SAR and EO imagery — and AIS data. The system must:
 
- **(a)** Detect and characterise the oil spill, calculating geometric properties and age where feasible
- **(b)** Using oceanographic and meteorological data, trace the slick back to its origin point and time, and predict its future flow
- **(c)** Analyse and attribute the spill to a vessel using historic AIS data — reconstructing vessel traffic around the origin window in space and time, filtering out irrelevant traffic, and scoring potential suspect vessels based on proximity, trajectory, and behavioural anomalies
**Expected Solution:** An automated detection and hindcasting machine learning model that identifies oil slicks from satellite imagery, maps their drift paths backward and forward, and ranks potential culprit vessels based on spatio-temporal correlation with AIS data — supported by a visual interface.
 
---
 
## Solution Overview
 
The platform implements an end-to-end investigation pipeline addressing all three parts of the problem statement:
 
1. **SAR Detection** — Processes Sentinel-1 SAR imagery to detect oil spill pixels using computer vision / deep learning segmentation
2. **Geometry Extraction** — Converts the detected spill mask into a geo-referenced polygon with area, shape, and centroid
3. **Drift / Hindcast Modeling** — Reconstructs the probable spill origin by running wind and current drift vectors backward from the observed spill centroid (Lagrangian-style particle backtracking), and projects forward for spread forecasting
4. **Oil Quantity Estimation** — Estimates spill volume and tonnage from the detected area using configurable film-thickness assumptions
5. **AIS Vessel Attribution** — Filters, analyses, and scores candidate vessels against the estimated origin using:
   - Spatial proximity to the origin zone
   - Temporal presence during the estimated release window
   - Trajectory alignment with the reconstructed drift path
   - AIS transmission gap detection (unexplained signal loss)
6. **Forensic Report Generation** — Interactive dashboard with map layers, ranked vessel evidence, and an exportable investigation report
**Note on scope:** The platform reports a *source-association score* per candidate vessel, not a determination of guilt. It is designed as decision support for human investigators, consistent with the responsible-attribution framing required by the problem statement.
 
---
 
## Screenshots
 
 
| Dashboard |
|---|
| <img width="1917" height="916" alt="Screenshot 2026-09-20 200354" src="https://github.com/user-attachments/assets/674001bd-a00e-4fb3-b849-3553a23d8974" /> |
 | <img width="1917" height="907" alt="Screenshot 2026-09-20 200547" src="https://github.com/user-attachments/assets/c8e7e8d7-82c1-4a7b-a521-79f66cce9664" /> |
  | <img width="1917" height="917" alt="Screenshot 2026-09-20 201655" src="https://github.com/user-attachments/assets/37fd8841-cb56-4377-9faa-78b95fbb067e" /> |

 
## Architecture
 
```
┌─────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Port 3000)                        │
│  Express Static Server │ Leaflet Map │ Vanilla JS SPA              │
│  ─ Dashboard, Incidents Archive, Forensic Report, System Info      │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ POST /api/investigate
                           │ POST /api/suspects
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        BACKEND (Port 8000)                          │
│  FastAPI │ Uvicorn │ Python 3.10+                                   │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │  ml_service  │  │ drift_service│  │   ais_attribution        │  │
│  │  (detection) │─▶│ (hindcast +  │─▶│   (vessel scoring,       │  │
│  │              │  │  forecast)   │  │    gap detection)         │  │
│  └──────────────┘  └──────┬───────┘  └──────────────────────────┘  │
│                           │                                        │
│                    ┌──────▼───────┐                                │
│                    │geometry_     │                                │
│                    │service       │                                │
│                    │(mask→polygon)│                                │
│                    └──────────────┘                                │
└─────────────────────────────────────────────────────────────────────┘
```
 
---
 
## Tech Stack
 
| Layer | Technology |
|-------|-----------|
| **Backend Framework** | Python FastAPI 0.141 |
| **ASGI Server** | Uvicorn 0.52 |
| **Geospatial** | Rasterio, Shapely, OpenCV |
| **Scientific** | NumPy, SciPy, Matplotlib |
| **Frontend** | Vanilla JS, Leaflet 1.9, Esri/OSM tiles |
| **Frontend Server** | Node.js Express 5 |
 
---
 
## Quick Start
 
### Prerequisites
 
- **Node.js 18+** and **npm**
- **Python 3.10+** and **pip**
### 1. Clone & install
 
```powershell
git clone https://github.com/nanddniii/oil-spill-project.git
cd oil-spill-project
npm install
pip install -r backend/requirements.txt
```
 
### 2. Start the backend (Terminal 1)
 
```powershell
cd backend
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```
 
Verify: open http://127.0.0.1:8000
 
### 3. Start the frontend (Terminal 2)
 
```powershell
cd oil-spill-project
npm start
```
 
### 4. Open
 
http://localhost:3000
 
---
 
## Usage Guide
 
### Investigation Flow
 
1. Open the dashboard at http://localhost:3000
2. Fill the investigation form:
   - **Latitude / Longitude** — approximate spill location
   - **Timestamp** — when the satellite image was acquired
   - **SAR Image** — upload a Sentinel-1 image (or any image for demo)
3. Click **Investigate**
4. Results appear on the map:
   - **Spill polygon** — detected oil extent
   - **Origin circle** — estimated spill origin with uncertainty radius
   - **Drift path** — reconstructed backward trajectory
   - **Forecast polygon** — predicted 6-hour spread
   - **Vessel markers** — candidate vessels with track lines and suspicion scores
5. Click vessel cards to see the scoring breakdown and highlight that vessel's track on the map
6. Navigate to **Forensic Report** for a printable investigation summary
### Demo Incident
 
The app loads a pre-configured demo incident (`SAR-2026-0881`) on first launch to showcase functionality without requiring a live API call.
 
---
 
## API Endpoints
 
### `GET /` — Health check
 
```json
{"message": "Oil Spill Investigation API is running"}
```
 
### `POST /api/investigate` — Full investigation pipeline
 
Accepts `multipart/form-data`:
- `latitude` (float) — approximate spill latitude
- `longitude` (float) — approximate spill longitude
- `timestamp` (string) — ISO-8601 acquisition time
- `image` (file) — SAR satellite image upload
Returns: spill polygon, origin estimate with uncertainty, drift forecast, oil quantity estimate, and ranked vessel candidates with scoring breakdown.
 
### `POST /api/suspects` — Standalone vessel re-scoring
 
Accepts JSON:
- `latitude`, `longitude`, `spill_time`, `uncertainty_km`
Returns re-ranked vessel list without re-running detection/drift. Useful for "what-if" scenario analysis.
 
---
 
## Data Sources & Limitations
 
- **SAR imagery & training data:** sourced from public research datasets (Zenodo Sentinel-1 SAR oil spill imagery, including labeled oil / no-oil / look-alike samples)
- **AIS vessel data:** uses public historical sources (e.g. NOAA Marine Cadastre) where region/time alignment permits; synthetic AIS data — generated using the real public schema, anchored to real spill coordinates — is used to demonstrate and validate the attribution pipeline where matching real historical data isn't available
- **Why synthetic AIS is used:** no public dataset exists linking real, legally confirmed oil spill incidents to a specific responsible vessel via AIS reconstruction — this data is legally sensitive and not published. Real confirmed cases (e.g. the 2018 Balikpapan Bay spill) are typically resolved through physical forensic evidence rather than published AIS trajectory analysis
- **Validation approach:** the attribution/scoring logic is validated using synthetic test scenarios with a deliberately placed "known" candidate vessel among decoys, measuring how reliably the system ranks it correctly
- **Current status:** this is a working prototype. Detection accuracy is measurable against labeled test data; drift and attribution outputs are not yet validated against real-world confirmed incidents, for the data-availability reasons above
---
 
## Testing
 
```powershell
cd backend
pytest -v
```
 
Runs integration and unit tests for the geometry extraction, drift model, and AIS attribution pipeline.
  
---
 
## License
 
This project was built for Smart India Hackathon 2026 (educational/hackathon use).
 
