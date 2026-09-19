
import { fetchIncidentData, fetchAllIncidents } from './mockdata.js';

import { initMap, invalidateMapSize } from './map.js';

import { renderVesselPanel } from './panels.js';


let currentIncidentData = null;
const INVESTIGATE_ENDPOINT = 'http://127.0.0.1:8000/api/investigate';


document.addEventListener('DOMContentLoaded', () => {
  initializeApp();
  setupNavigation();
  setupInvestigationForm();
});



async function initializeApp() {
  await loadIncident('SAR-2026-0881');
  await loadIncidentArchive();
  renderReport();
}


async function loadIncident(incidentId) {
  try {
    
    const data = await fetchIncidentData(incidentId);
    
   
    currentIncidentData = data;

   
    initMap('map', data);

    renderVesselPanel(data);


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
    speedKnots: vessel.speed_knots ?? '',
    position,
    heading: vessel.heading,
    trackHistory,
    distanceKm: vessel.distance_km,
    timeDifferenceMinutes: vessel.time_difference_minutes,
    riskLevel: vessel.risk_level,
    confidence: vessel.confidence,
    suspicionScore: Number(vessel.score),
    explanation: Array.isArray(vessel.reasons) ? vessel.reasons.join('. ') : '',
    scoreBreakdown: {
      proximityScore: breakdown.distance,
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

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item[data-view]');
  navItems.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetViewId = btn.dataset.view;
      switchView(targetViewId);
    });
  });
}

function switchView(targetViewId) {
  // Hide all views
  document.querySelectorAll('.app-view').forEach(view => {
    view.classList.remove('active');
  });

  // Show the target view
  const target = document.getElementById(targetViewId);
  if (target) {
    target.classList.add('active');
  }

  // Update nav active state
  document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === targetViewId);
  });

  // When switching to Dashboard, invalidate Leaflet map size so it re-renders perfectly!
  if (targetViewId === 'view-dashboard') {
    invalidateMapSize();
  }

  // Re-render report with latest data each time it is opened
  if (targetViewId === 'view-report') {
    renderReport();
  }
}

// ---------------------------------------------------------------------------
// Incidents Archive view
// ---------------------------------------------------------------------------
async function loadIncidentArchive() {
  const grid = document.getElementById('incident-archive-grid');
  if (!grid) return;

  try {
    const incidents = await fetchAllIncidents();
    grid.innerHTML = '';

    incidents.forEach(inc => {
      const card = document.createElement('div');
      card.className = 'archive-card';
      const conf = Number(inc.detectionConfidence);
      const score = Number(inc.highestSuspicionScore);
      const scoreClass = score >= 70 ? 'score-badge-red' : score >= 40 ? 'score-badge-amber' : 'score-badge-teal';

      // Full-width list card layout matching screenshot 1
      card.innerHTML = `
        <div class="archive-card-header">
          <span class="archive-card-id">${inc.id}</span>
          <span class="archive-score-badge ${scoreClass}">Score: ${score}/100</span>
        </div>
        <div class="archive-card-title">${inc.title}</div>
        <div class="archive-card-meta">
          <span>${inc.satellite}</span>
          <span class="meta-dot-sep">• •</span>
          <span>${inc.acquiredUtc}</span>
        </div>
        <div class="archive-stats-row">
          <div class="archive-stat-box">
            <div class="archive-stat-lbl">SPILL AREA</div>
            <div class="archive-stat-val">${inc.spillAreaKm2} km²</div>
          </div>
          <div class="archive-stat-box">
            <div class="archive-stat-lbl">CONFIDENCE</div>
            <div class="archive-stat-val">${conf.toFixed(1)}%</div>
          </div>
        </div>
      `;

      card.addEventListener('click', async () => {
        // Switch view first so the map container is active & visible with real layout dimensions
        switchView('view-dashboard');
        await loadIncident(inc.id);
        invalidateMapSize();
      });

      grid.appendChild(card);
    });
  } catch (err) {
    console.error('Failed to load incident archive:', err);
    if (grid) grid.innerHTML = '<p class="archive-empty">Failed to load archive.</p>';
  }
}

// ---------------------------------------------------------------------------
// Forensic Report view
// ---------------------------------------------------------------------------
function renderReport() {
  const container = document.getElementById('report-body');
  if (!container) return;

  if (!currentIncidentData) {
    container.innerHTML = '<p class="archive-empty">No active incident. Run an investigation on the Dashboard first.</p>';
    return;
  }

  const d = currentIncidentData;
  const oilQ = d.oilQuantity || d.oilQuantityEstimate || {};
  const qRange = oilQ.quantity_range_tonnes || {};
  const tRange = oilQ.thickness_range_microns || {};
  const candidates = Array.isArray(d.candidates) ? d.candidates : [];
  const sortedCandidates = [...candidates].sort((a, b) => b.suspicionScore - a.suspicionScore);
  const topCandidate = sortedCandidates[0] || null;

  const confVal  = d.detectionConfidence != null ? `${d.detectionConfidence}%` : '-';
  const areaVal  = d.spillAreaKm2 != null ? `${d.spillAreaKm2} km²` : '-';
  const volumeVal = d.spillVolumeEstM3 || (oilQ.estimated_quantity_tonnes ? `${formatSafe(oilQ.estimated_quantity_tonnes)} t` : '140–180 m³');
  const topScore = topCandidate ? topCandidate.suspicionScore : 88;
  const topScoreFormatted = `${topScore} / 100`;

  // Format region short version if needed
  const displayRegion = d.region ? d.region.replace('Traffic Separation Scheme', 'TSS') : 'North Sea / Dover Strait TSS';
  const displayTime = d.acquiredUtc ? d.acquiredUtc.replace(/:\d{2}\sUTC/, ' UTC') : '2026-08-25 14:22 UTC';
  const displayPlatform = d.satellite ? d.satellite.replace(' Mode', '').replace('SAR-C EW', 'SAR-C EW') : 'Sentinel-1A (SAR-C EW)';

  container.innerHTML = `
    <!-- ── REPORT HEADER (matching screenshot 2) ── -->
    <div class="rpt-top-bar">
      <div class="rpt-header-text">
        <div class="rpt-top-pretitle">SAR-BASED OIL SPILL SOURCE ASSESSMENT</div>
        <h1 class="rpt-page-title">FORENSIC INVESTIGATION REPORT</h1>
        
        <!-- Metadata chips row -->
        <div class="rpt-meta-chips">
          <div class="rpt-meta-chip">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span>Incident #${d.id}</span>
          </div>
          <div class="rpt-meta-chip">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span>${displayTime}</span>
          </div>
          <div class="rpt-meta-chip">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            <span>${displayRegion}</span>
          </div>
        </div>
      </div>

      <!-- Action buttons -->
      <div class="rpt-action-btns">
        <button class="rpt-btn-print" onclick="window.print()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          Print Report
        </button>
        <button class="rpt-btn-save" id="save-report-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Save Report
        </button>
      </div>
    </div>

    <!-- Cyan Accent Divider -->
    <div class="rpt-cyan-accent-line"></div>

    <!-- ── 4 STAT METRIC CARDS (matching screenshot 2) ── -->
    <div class="rpt-stats-row-4">
      <div class="rpt-stat-box-card rpt-stat-cyan">
        <div class="rpt-stat-primary-val text-cyan">${confVal}</div>
        <div class="rpt-stat-primary-lbl">DETECTION CONFIDENCE</div>
      </div>
      <div class="rpt-stat-box-card">
        <div class="rpt-stat-primary-val">${areaVal}</div>
        <div class="rpt-stat-primary-lbl">SPILL AREA</div>
      </div>
      <div class="rpt-stat-box-card">
        <div class="rpt-stat-primary-val">${volumeVal}</div>
        <div class="rpt-stat-primary-lbl">EST. VOLUME</div>
      </div>
      <div class="rpt-stat-box-card rpt-stat-amber">
        <div class="rpt-stat-primary-val text-amber">${topScoreFormatted}</div>
        <div class="rpt-stat-primary-lbl">TOP CANDIDATE SCORE</div>
      </div>
    </div>

    <!-- ── 01 INCIDENT OVERVIEW (Two-column layout matching screenshot 2) ── -->
    <div class="rpt-section-block">
      <div class="rpt-block-header">
        <span class="rpt-badge-num">01</span>
        <h2 class="rpt-block-title">INCIDENT OVERVIEW</h2>
      </div>
      <div class="rpt-two-col-card">
        <div class="rpt-col-half">
          <div class="rpt-meta-item">
            <span class="rpt-item-label">Incident ID</span>
            <span class="rpt-item-val text-cyan font-mono">${d.id}</span>
          </div>
          <div class="rpt-meta-item">
            <span class="rpt-item-label">Title</span>
            <span class="rpt-item-val font-bold">${d.title || 'North Sea Sector 4 Oil Discharge'}</span>
          </div>
          <div class="rpt-meta-item">
            <span class="rpt-item-label">Region</span>
            <span class="rpt-item-val">${displayRegion}</span>
          </div>
        </div>
        <div class="rpt-col-half">
          <div class="rpt-meta-item">
            <span class="rpt-item-label">SAR Platform</span>
            <span class="rpt-item-val">${displayPlatform}</span>
          </div>
          <div class="rpt-meta-item">
            <span class="rpt-item-label">Detection Time</span>
            <span class="rpt-item-val font-mono">${d.acquiredUtc}</span>
          </div>
          <div class="rpt-meta-item">
            <span class="rpt-item-label">Confidence</span>
            <span class="rpt-item-val font-mono">${confVal}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ── 02 SOURCE RECONSTRUCTION (Two-column layout matching screenshot 2) ── -->
    <div class="rpt-section-block">
      <div class="rpt-block-header">
        <span class="rpt-badge-num">02</span>
        <h2 class="rpt-block-title">SOURCE RECONSTRUCTION</h2>
      </div>
      <div class="rpt-two-col-card">
        <div class="rpt-col-half">
          <div class="rpt-meta-item">
            <span class="rpt-item-label">Spill Area</span>
            <span class="rpt-item-val font-mono">${d.spillAreaKm2} km²</span>
          </div>
          <div class="rpt-meta-item">
            <span class="rpt-item-label">Spill Length</span>
            <span class="rpt-item-val font-mono">${d.spillLengthNm ? d.spillLengthNm + ' nm' : '3.4 nm'}</span>
          </div>
        </div>
        <div class="rpt-col-half">
          <div class="rpt-meta-item">
            <span class="rpt-item-label">Origin (lat, lng)</span>
            <span class="rpt-item-val font-mono">${d.originPoint ? d.originPoint.lat.toFixed(4) + '°, ' + d.originPoint.lng.toFixed(4) + '°' : '-'}</span>
          </div>
          <div class="rpt-meta-item">
            <span class="rpt-item-label">Uncertainty Radius</span>
            <span class="rpt-item-val font-mono">${d.originPoint ? '±' + d.originPoint.uncertaintyRadiusMeters + ' m' : '-'}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ── 03 CANDIDATE VESSELS ── -->
    ${topCandidate ? (() => {
      const sc = topCandidate.suspicionScore;
      const riskCls = sc >= 70 ? 'text-red' : sc >= 40 ? 'text-amber' : 'text-cyan';
      const riskLabel = sc >= 70 ? 'HIGH' : sc >= 40 ? 'MEDIUM' : 'LOW';
      const barPct = Math.min(sc, 100);
      const barCls = sc >= 70 ? 'score-red' : sc >= 40 ? 'score-amber' : 'score-teal';
      return `
    <div class="rpt-section-block">
      <div class="rpt-block-header">
        <span class="rpt-badge-num">03</span>
        <h2 class="rpt-block-title">CANDIDATE VESSELS <span class="report-ais-note">— AIS: Synthetic demonstration data</span></h2>
      </div>

      <div class="rpt-top-candidate">
        <div class="rpt-top-candidate-badge">TOP SOURCE-ASSOCIATION CANDIDATE</div>
        <div class="rpt-top-candidate-body">
          <div class="rpt-top-candidate-left">
            <div class="rpt-top-vessel-name">${topCandidate.name} <span class="vessel-country-code">${topCandidate.flagCode || ''}</span></div>
            <div class="rpt-top-vessel-meta">
              <span>MMSI: ${topCandidate.mmsi}</span>
              ${topCandidate.type ? `<span>•</span><span>${topCandidate.type}</span>` : ''}
              ${topCandidate.distanceKm != null ? `<span>•</span><span>${topCandidate.distanceKm} km from origin</span>` : ''}
            </div>
            <div class="rpt-top-vessel-explanation">${topCandidate.explanation || ''}</div>
          </div>
          <div class="rpt-top-candidate-right">
            <div class="rpt-score-ring">
              <div class="rpt-score-num ${riskCls}">${sc}<span class="rpt-score-denom">/100</span></div>
            </div>
            <div class="rpt-risk-badge">${riskLabel}</div>
          </div>
        </div>
        <div class="rpt-score-bar-wrap">
          <div class="rpt-score-bar-track">
            <div class="rpt-score-bar-fill ${barCls}" style="width:${barPct}%"></div>
          </div>
          <span class="rpt-score-bar-label">Source Association Score</span>
        </div>
        <div class="rpt-top-factors">
          <div class="rpt-factor-chip">
            <span class="rpt-factor-key">PROXIMITY INDEX</span>
            <span class="rpt-factor-val">${topCandidate.scoreBreakdown?.proximityScore ?? '-'}%</span>
          </div>
          <div class="rpt-factor-chip">
            <span class="rpt-factor-key">TRAJECTORY MATCH</span>
            <span class="rpt-factor-val">${topCandidate.scoreBreakdown?.trajectoryMatchScore ?? '-'}%</span>
          </div>
          <div class="rpt-factor-chip">
            <span class="rpt-factor-key">AIS SIGNAL GAP</span>
            <span class="rpt-factor-val ${topCandidate.scoreBreakdown?.aisGapDetected ? 'text-red' : 'text-cyan'}">${topCandidate.scoreBreakdown?.aisGapDetected ? 'Detected (' + topCandidate.scoreBreakdown.aisGapDurationMins + ' min)' : 'None'}</span>
          </div>
          <div class="rpt-factor-chip">
            <span class="rpt-factor-key">SPEED ANOMALY</span>
            <span class="rpt-factor-val ${topCandidate.scoreBreakdown?.speedAnomalyDetected ? 'text-amber' : 'text-cyan'}">${topCandidate.scoreBreakdown?.speedAnomalyDetected ? 'Flagged' : 'Normal'}</span>
          </div>
        </div>
      </div>

      ${sortedCandidates.length > 1 ? `
      <div class="rpt-other-vessels-label">ALL RANKED CANDIDATES</div>
      <div class="rpt-other-vessels-list">
      ${sortedCandidates.map(v => {
        const s = v.suspicionScore;
        const c = s >= 70 ? 'text-red' : s >= 40 ? 'text-amber' : 'text-cyan';
        return `
        <div class="report-vessel">
          <div class="report-vessel-header">
            <span class="report-vessel-name">${v.name} <span class="vessel-country-code">${v.flagCode || ''}</span></span>
            <span class="report-vessel-score ${c}">${s}/100</span>
          </div>
          <div class="report-table">
            <div class="report-row"><span class="report-label">MMSI</span><span class="report-val font-mono">${v.mmsi}</span></div>
            <div class="report-row"><span class="report-label">Type</span><span class="report-val">${v.type || '-'}</span></div>
            <div class="report-row"><span class="report-label">Distance</span><span class="report-val font-mono">${v.distanceKm ?? '-'} km</span></div>
            <div class="report-row"><span class="report-label">AIS Gap</span><span class="report-val font-mono ${v.scoreBreakdown?.aisGapDetected ? 'text-red' : 'text-cyan'}">${v.scoreBreakdown?.aisGapDetected ? 'Detected (' + v.scoreBreakdown.aisGapDurationMins + ' min)' : 'None'}</span></div>
          </div>
        </div>`;
      }).join('')}
      </div>` : ''}
    </div>`;
    })() : ''}

    <!-- ── 04 DRIFT & FORECAST ── -->
    <div class="rpt-section-block">
      <div class="rpt-block-header">
        <span class="rpt-badge-num">04</span>
        <h2 class="rpt-block-title">DRIFT &amp; FORECAST</h2>
      </div>
      <div class="rpt-two-col-card">
        <div class="rpt-col-half">
          <div class="rpt-meta-item">
            <span class="rpt-item-label">Drift Model</span>
            <span class="rpt-item-val">Lagrangian back-propagation</span>
          </div>
          <div class="rpt-meta-item">
            <span class="rpt-item-label">Wind Vector</span>
            <span class="rpt-item-val font-mono">${d.windVector || '-'}</span>
          </div>
        </div>
        <div class="rpt-col-half">
          <div class="rpt-meta-item">
            <span class="rpt-item-label">+6h Forecast</span>
            <span class="rpt-item-val">${d.predictedPolygonGeoJSON ? 'Predicted spread polygon available' : 'Active model forecast'}</span>
          </div>
          <div class="rpt-meta-item">
            <span class="rpt-item-label">Drift Path Points</span>
            <span class="rpt-item-val font-mono">${Array.isArray(d.driftPath) && d.driftPath.length ? d.driftPath.length + ' waypoints' : '-'}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ── 05 FORENSIC ASSESSMENT ── -->
    <div class="rpt-section-block">
      <div class="rpt-block-header">
        <span class="rpt-badge-num">05</span>
        <h2 class="rpt-block-title">FORENSIC ASSESSMENT</h2>
      </div>
      <div class="rpt-assessment-box">
        <p>Based on SAR image analysis, Lagrangian origin reconstruction, and cross-referencing of synthetic AIS vessel tracks, the pipeline identified <strong>${sortedCandidates.length}</strong> candidate vessel(s) within the reconstructed origin window.</p>
        ${topCandidate ? `<p>The highest-ranked source-association candidate is <strong>${topCandidate.name}</strong> with a score of <strong class="${topCandidate.suspicionScore >= 70 ? 'text-red' : topCandidate.suspicionScore >= 40 ? 'text-amber' : 'text-cyan'}">${topCandidate.suspicionScore}/100</strong>. This vessel transited within the reconstructed origin region during the discharge window and exhibited the following indicators: ${topCandidate.explanation || 'see score breakdown above'}.</p>` : ''}
        <p class="rpt-assessment-caveat">This assessment is based on synthetic AIS data and estimated oil quantities. It is produced for demonstration purposes and does not constitute a legally admissible finding.</p>
      </div>
    </div>

    <!-- ── FOOTER: DATA & ASSUMPTIONS ── -->
    <div class="rpt-footer-box">
      <div class="rpt-footer-title">DATA &amp; ASSUMPTIONS</div>
      <div class="rpt-footer-items">
        <div class="rpt-footer-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span><strong>AIS:</strong> Synthetic demonstration data — not sourced from real-time or historical vessel transponders.</span>
        </div>
        <div class="rpt-footer-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <span><strong>Oil quantity:</strong> Estimated from spill area × assumed film thickness range. Not a direct measurement.</span>
        </div>
      </div>
    </div>
  `;

  // Wire up Save Report button (html2pdf if available, else print fallback)
  const saveBtn = container.querySelector('#save-report-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      if (typeof html2pdf !== 'undefined') {
        html2pdf().set({ margin: 10, filename: `forensic-report-${d.id}.pdf`, html2canvas: { scale: 2 }, jsPDF: { format: 'a4' } }).from(container).save();
      } else {
        window.print();
      }
    });
  }
}

function formatSafe(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 3 }) : '-';
}
