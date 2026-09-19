
import { fetchIncidentData } from './mockdata.js';

import { initMap } from './map.js';

import { renderVesselPanel } from './panels.js';
import { renderForensicReport, setupReportActions } from './report.js';


let currentIncidentData = null;
const INVESTIGATE_ENDPOINT = 'http://127.0.0.1:8000/api/investigate';


document.addEventListener('DOMContentLoaded', () => {
  initializeApp();
  setupInvestigationForm();
  setupNavigation();
  setupReportActions();
});



async function initializeApp() {
  
//   setupNavigation();

  await loadIncident('SAR-2026-0881');

  if (window.location.pathname === '/forensic-report') {
    document.getElementById('nav-report')?.click();
  }

//   await loadIncidentArchive();
}


async function loadIncident(incidentId) {
  try {
    
    const data = await fetchIncidentData(incidentId);
    
   
    currentIncidentData = data;

   
    initMap('map', data);

    renderVesselPanel(data);
    renderForensicReport(data);


  } catch (err) {
    console.error('Failed to load incident data:', err);
  }
}

function setupInvestigationForm() {
  const form = document.getElementById('investigation-form');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const status = document.getElementById('investigation-status');
    const button = document.getElementById('investigate-button');
    const image = document.getElementById('investigation-image')?.files?.[0];
    const latitude = document.getElementById('investigation-latitude')?.value;
    const longitude = document.getElementById('investigation-longitude')?.value;
    const timestamp = document.getElementById('investigation-timestamp')?.value;

    if (!image || latitude === '' || longitude === '' || !timestamp) {
      setRequestStatus(status, 'Enter all fields and choose a SAR image.', true);
      return;
    }

    const selectedTimestamp = new Date(timestamp);
    if (Number.isNaN(selectedTimestamp.getTime())) {
      setRequestStatus(status, 'Choose a valid timestamp.', true);
      return;
    }

    const formData = new FormData();
    formData.append('latitude', latitude);
    formData.append('longitude', longitude);
    formData.append('timestamp', selectedTimestamp.toISOString());
    formData.append('image', image);

    button.disabled = true;
    setRequestStatus(status, 'Investigating image...', false);

    try {
      const response = await fetch(INVESTIGATE_ENDPOINT, {
        method: 'POST',
        body: formData
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, response.status));
      }

      const adaptedData = adaptInvestigationResponse(payload, image.name);
      currentIncidentData = adaptedData;

      // The existing map requires vessel coordinates and a drift line. Keep
      // those layers empty when the API does not provide those data points.
      const mapData = {
        ...adaptedData,
        candidates: adaptedData.candidates.filter(hasMapTrack),
        driftPath: adaptedData.driftPath || []
      };
      initMap('map', mapData);
      renderVesselPanel(adaptedData);
      renderForensicReport(adaptedData);
      setRequestStatus(status, 'Investigation complete.', false);
    } catch (error) {
      console.error('Investigation request failed:', error);
      setRequestStatus(status, error.message || 'Investigation failed.', true);
    } finally {
      button.disabled = false;
    }
  });
}

function adaptInvestigationResponse(response, imageName) {
  const spill = response.spill || {};
  const origin = response.origin || {};
  const geometry = response.geometry || {};
  const prediction = response.prediction || {};
  const oilQuantity = response.oil_quantity || {};
  const polygon = geometry.polygon_geojson?.coordinates?.[0] || [];

  return {
    id: `API-${Date.now()}`,
    title: 'Oil Spill Investigation',
    satellite: imageName || 'Uploaded SAR image',
    acquiredUtc: new Date().toISOString(),
    region: `${Number(origin.latitude).toFixed(4)}°, ${Number(origin.longitude).toFixed(4)}°`,
    centerCoords: {
      lat: Number(origin.latitude),
      lng: Number(origin.longitude)
    },
    spillAreaKm2: Number(spill.area_km2 || geometry.area_km2 || 0),
    oilQuantity,
    oilQuantityEstimate: oilQuantity,
    spillVolumeEstM3: oilQuantity.volume_range_m3
      ? `${oilQuantity.volume_range_m3.min}-${oilQuantity.volume_range_m3.max} m³`
      : 'Unavailable',
    detectionConfidence: Number(spill.confidence || 0) * 100,
    originPoint: {
      lat: Number(origin.latitude),
      lng: Number(origin.longitude),
      uncertaintyRadiusMeters: Number(origin.uncertainty_km || 0) * 1000
    },
    spillPolygon: polygon.map(([lng, lat]) => [lat, lng]),
    // The backend returns a predicted polygon, not a time-stepped path.
    // Leave this empty rather than fabricating drift waypoints.
    predictedPolygonGeoJSON: prediction.predicted_polygon_geojson || null,
    driftPath: [],
    windVector: 'Unavailable',
    candidates: (response.vessels || []).map(adaptVessel)
  };
}

function adaptVessel(vessel) {
  const breakdown = vessel.score_breakdown || {};
  const anomaly = Array.isArray(vessel.ais_anomalies) && vessel.ais_anomalies.length > 0;
  const position = vessel.position && {
    lat: Number(vessel.position.latitude),
    lng: Number(vessel.position.longitude)
  };
  const trackHistory = Array.isArray(vessel.track_history)
    ? vessel.track_history.map((point) => [
      Number(point.latitude),
      Number(point.longitude)
    ])
    : [];

  return {
    id: vessel.id || vessel.mmsi,
    mmsi: vessel.mmsi || vessel.id,
    name: vessel.name,
    flagCode: '',
    type: vessel.vessel_type || '',
    movementDirection: vessel.movement_direction || '',
    speedKnots: vessel.speed_knots ?? '',
    position,
    heading: vessel.heading,
    trackHistory,
    distanceKm: vessel.distance_km,
    timeDifferenceMinutes: vessel.time_difference_minutes,
    riskLevel: vessel.risk_level,
    confidence: vessel.confidence,
    suspicionScore: Number(vessel.score),
    reasons: Array.isArray(vessel.reasons) ? vessel.reasons : [],
    explanation: Array.isArray(vessel.reasons) ? vessel.reasons.join('. ') : '',
    scoreBreakdown: {
      proximityScore: breakdown.distance,
      distanceScore: breakdown.distance_component ?? breakdown.distance,
      timeScore: breakdown.time_component ?? breakdown.time,
      trajectoryScore: breakdown.trajectory_component ?? Number(vessel.trajectory_alignment) * 100,
      presenceScore: breakdown.presence_component ?? breakdown.presence,
      aisAnomalyScore: breakdown.anomaly_component ?? breakdown.anomaly,
      speedScore: breakdown.speed_component ?? breakdown.speed,
      vesselTypeScore: breakdown.vessel_type_component ?? breakdown.vessel_type,
      trajectoryMatchScore: Number(vessel.trajectory_alignment) * 100,
      aisGapDetected: anomaly,
      aisGapDurationMins: anomaly
        ? Math.max(...vessel.ais_anomalies.map((gap) => Number(gap.gap_duration_minutes || 0)))
        : 0,
      speedAnomalyDetected: false,
      speedDropKnots: ''
    }
  };
}

function setupNavigation() {
  document.querySelectorAll('.nav-item[data-view]').forEach((item) => {
    item.addEventListener('click', () => {
      const viewId = item.dataset.view;
      document.querySelectorAll('.app-view').forEach((view) => {
        view.classList.toggle('active', view.id === viewId);
      });
      document.querySelectorAll('.nav-item').forEach((navItem) => {
        navItem.classList.toggle('active', navItem === item);
      });

      if (viewId === 'view-report' && currentIncidentData) {
        renderForensicReport(currentIncidentData);
      }
      if (viewId === 'view-dashboard' && currentIncidentData) {
        initMap('map', currentIncidentData);
      }
    });
  });
}

function hasMapTrack(vessel) {
  return Boolean(
    vessel.position &&
    Number.isFinite(vessel.position.lat) &&
    Number.isFinite(vessel.position.lng) &&
    Array.isArray(vessel.trackHistory) &&
    vessel.trackHistory.length > 0 &&
    vessel.trackHistory.every(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng))
  );
}

function getApiErrorMessage(payload, statusCode) {
  if (payload?.detail) {
    return typeof payload.detail === 'string'
      ? payload.detail
      : 'The backend rejected the investigation request.';
  }
  return `Investigation failed (HTTP ${statusCode}).`;
}

function setRequestStatus(element, message, isError) {
  if (!element) return;
  element.textContent = message;
  element.dataset.state = isError ? 'error' : 'normal';
}
