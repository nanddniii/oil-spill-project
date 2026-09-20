
import { fetchIncidentData } from './mockdata.js';

import { initMap, refreshMapSize } from './map.js';

import { renderVesselPanel } from './panels.js';

import { saveIncident, seedSampleIncident, formatArchiveId } from './archive.js';

import { renderIncidentsArchive, setArchiveStatus } from './incidents.js';


let currentIncidentData = null;
let investigationBannerTimer = null;
const INVESTIGATE_ENDPOINT = 'http://127.0.0.1:8000/api/investigate';


document.addEventListener('DOMContentLoaded', () => {
  initializeApp();
  setupInvestigationForm();
  setupInvestigationBanner();
});



async function initializeApp() {
  setupNavigation();

  await loadIncident('SAR-2026-0881');
}


async function loadIncident(incidentId) {
  try {

    const data = await fetchIncidentData(incidentId);

    // Make sure the demo incident is in the archive on first launch.
    seedSampleIncident(data);

    displayIncident(data);

  } catch (err) {
    console.error('Failed to load incident data:', err);
  }
}

// Shows an incident on the dashboard. Used for the initial load, for fresh
// investigation results and for incidents restored from the archive, so all
// three render identically.
function displayIncident(data, { showBanner = false } = {}) {
  currentIncidentData = data;

  if (showBanner) {
    updateInvestigationBanner('complete', data);
  } else {
    hideInvestigationBanner();
  }

  const mapData = {
    ...data,
    candidates: data.candidates,
    driftPath: data.driftPath || []
  };
  initMap('map', mapData);
  renderVesselPanel(data);
}

function setupNavigation() {
  document.querySelectorAll('.nav-item[data-view]').forEach((button) => {
    button.addEventListener('click', () => showView(button.dataset.view));
  });
}

function showView(viewId) {
  const target = document.getElementById(viewId);
  // Report and System Info have no view yet; leave the current view as is.
  if (!target) return false;

  document.querySelectorAll('.app-view').forEach((view) => {
    view.classList.toggle('active', view === target);
  });
  document.querySelectorAll('.nav-item[data-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === viewId);
  });

  if (viewId === 'view-dashboard') refreshMapSize();
  if (viewId === 'view-incidents') refreshIncidentsArchive();
  if (viewId === 'view-report') refreshForensicReport();
  return true;
}

function refreshIncidentsArchive() {
  setArchiveStatus('');
  renderIncidentsArchive({
    activeId: currentIncidentData?.id,
    onOpen: restoreIncident
  });
}

// Clicking an archive row brings that investigation back on the dashboard:
// map layers, incident metadata and candidate vessels.
function restoreIncident(record) {
  const data = record.data;
  const archiveId = formatArchiveId(record.no);

  if (!isRestorable(data)) {
    console.error('Archived incident is incomplete and cannot be restored:', record);
    setArchiveStatus(`${archiveId} is missing data and cannot be restored.`, true);
    return;
  }

  // Switch first: Leaflet can't size a map inside a hidden container.
  showView('view-dashboard');
  displayIncident(data, { showBanner: true });
  setRequestStatus(
    document.getElementById('investigation-status'),
    `Restored ${archiveId} from archive.`,
    false
  );
}

function isRestorable(data) {
  return Boolean(
    data &&
    Number.isFinite(data.centerCoords?.lat) &&
    Number.isFinite(data.centerCoords?.lng) &&
    Number.isFinite(data.originPoint?.lat) &&
    Number.isFinite(data.originPoint?.lng) &&
    Array.isArray(data.spillPolygon) &&
    Array.isArray(data.candidates)
  );
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

    const timestampIso = new Date(timestamp).toISOString();

    const formData = new FormData();
    formData.append('latitude', latitude);
    formData.append('longitude', longitude);
    formData.append('timestamp', timestampIso);
    formData.append('image', image);

    button.disabled = true;
    updateInvestigationBanner('progress');
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

      const adaptedData = adaptInvestigationResponse(payload, image.name, timestampIso);
      displayIncident(adaptedData, { showBanner: true });

      const saved = saveIncident(adaptedData);
      if (saved) {
        setRequestStatus(
          status,
          `Investigation complete. Saved to archive as ${formatArchiveId(saved.no)}.`,
          false
        );
      } else {
        setRequestStatus(
          status,
          'Investigation complete, but it could not be saved to the archive (browser storage is full or unavailable).',
          true
        );
      }
    } catch (error) {
      console.error('Investigation request failed:', error);
      updateInvestigationBanner('error', null, error.message || 'Investigation failed.');
      setRequestStatus(status, error.message || 'Investigation failed.', true);
    } finally {
      button.disabled = false;
    }
  });
}

function setupInvestigationBanner() {
  document.getElementById('investigation-banner-close')?.addEventListener('click', hideInvestigationBanner);
}

function updateInvestigationBanner(state, data = null, errorMessage = '') {
  const banner = document.getElementById('investigation-banner');
  const heading = document.getElementById('investigation-banner-state');
  const summary = document.getElementById('investigation-banner-summary');
  const checks = document.getElementById('investigation-banner-checks');
  if (!banner || !heading || !summary || !checks) return;

  clearTimeout(investigationBannerTimer);
  banner.hidden = false;
  banner.dataset.state = state;
  checks.replaceChildren();

  if (state === 'complete') {
    if (!isSpillDetected(data)) {
      heading.textContent = 'No spill detected in this image';
      summary.textContent = '';
      investigationBannerTimer = setTimeout(hideInvestigationBanner, 10000);
      return;
    }

    const steps = getInvestigationSteps(data);
    heading.textContent = 'INVESTIGATION COMPLETE';
    summary.textContent = data?.title || 'All investigation stages completed';
    steps.forEach((step) => {
      const item = document.createElement('span');
      item.textContent = step;
      checks.appendChild(item);
    });
    investigationBannerTimer = setTimeout(hideInvestigationBanner, 10000);
    return;
  }

  if (state === 'error') {
    heading.textContent = 'Investigation failed';
    summary.textContent = errorMessage;
    investigationBannerTimer = setTimeout(hideInvestigationBanner, 10000);
    return;
  }

  heading.textContent = 'Investigating...';
  summary.textContent = 'Analyzing SAR, reconstructing origin, and correlating AIS';
}

function hideInvestigationBanner() {
  clearTimeout(investigationBannerTimer);
  const banner = document.getElementById('investigation-banner');
  if (banner) banner.hidden = true;
}

function getInvestigationSteps(data) {
  const steps = [];
  const area = Number(data?.spillAreaKm2);
  const confidence = Number(data?.detectionConfidence);
  if (isSpillDetected(data)) {
    steps.push(`SAR spill detected - ${formatNumber(area)} km2, ${formatNumber(confidence)}%`);
  }

  if (Number.isFinite(data?.originPoint?.lat) && Number.isFinite(data?.originPoint?.lng)) {
    steps.push('Origin reconstructed');
  }

  if (data?.aisCorrelationCompleted !== false && Array.isArray(data?.candidates)) {
    const count = data.candidates.length;
    steps.push(count === 0 ? 'No candidate vessels found' : `${count} candidate vessels identified`);
  }

  if (hasForecast(data)) steps.push('+6h forecast generated');
  return steps;
}

function isSpillDetected(data) {
  return Number(data?.spillAreaKm2) > 0 && Number(data?.detectionConfidence) > 0;
}

function hasForecast(data) {
  return (Array.isArray(data?.driftPath) && data.driftPath.length > 0) ||
    data?.forecastAvailable === true ||
    (Array.isArray(data?.forecastPolygon) && data.forecastPolygon.length > 0);
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function adaptInvestigationResponse(response, imageName, incidentTimeIso) {
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
    // The time the user entered for the incident (what the archive dates by).
    acquiredUtc: incidentTimeIso || new Date().toISOString(),
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
    driftPath: [],
    predictedPolygonGeoJSON: prediction.predicted_polygon_geojson || null,
    forecastAvailable: Boolean(prediction.predicted_polygon_geojson),
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
    // Which stretch of the track the transponder was silent for (the map dashes it)
    aisGapRanges: findGapRanges(vessel.track_history, vessel.ais_anomalies),
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

// Turns the API's AIS gaps (start/end timestamps) into [startIndex, endIndex]
// pairs into the vessel's track, by matching them to the track points' timestamps.
function findGapRanges(track, gaps) {
  if (!Array.isArray(track) || !Array.isArray(gaps)) return [];

  const times = track.map((point) => Date.parse(point.timestamp));
  const ranges = [];
  gaps.forEach((gap) => {
    const start = times.indexOf(Date.parse(gap.gap_start));
    const end = times.indexOf(Date.parse(gap.gap_end));
    if (start !== -1 && end > start) ranges.push([start, end]);
  });
  return ranges;
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

// ---------- Forensic Report ----------

function refreshForensicReport() {
  const data = currentIncidentData;

  // Update the static header elements
  const idEl = document.getElementById('report-incident-id');
  if (idEl) idEl.textContent = data ? `Incident #${data.id}` : '—';

  // Stat cards (always update even if no data)
  const statConf = document.getElementById('stat-confidence');
  const statArea = document.getElementById('stat-area');
  const statOil  = document.getElementById('stat-oil');

  const body = document.getElementById('report-body');
  if (!body) return;

  if (!data) {
    if (statConf) statConf.textContent = '—';
    if (statArea) statArea.textContent = '—';
    if (statOil)  statOil.textContent  = '—';
    body.innerHTML = '<p class="report-empty">Run an investigation from the Dashboard to generate a forensic report.</p>';
    return;
  }

  const oilQ          = data.oilQuantity || data.oilQuantityEstimate || {};
  const quantityRange = oilQ.quantity_range_tonnes || {};
  const thicknessRange= oilQ.thickness_range_microns || {};
  const fmtNum = (v, dec = 1) => Number.isFinite(Number(v))
    ? Number(v).toLocaleString(undefined, { maximumFractionDigits: dec })
    : '—';

  // Stat cards
  if (statConf) statConf.textContent = data.detectionConfidence != null ? `${fmtNum(data.detectionConfidence)}%` : '—';
  if (statArea) statArea.textContent = data.spillAreaKm2 != null ? fmtNum(data.spillAreaKm2, 2) : '—';
  if (statOil)  statOil.textContent  = fmtNum(oilQ.estimated_quantity_tonnes, 1);

  // Sort candidates
  const candidates = [...(data.candidates || [])].sort((a, b) => b.suspicionScore - a.suspicionScore);
  const top = candidates[0] || null;

  // ── Risk colour helpers ──
  const riskColor = (score) => score >= 70 ? 'red' : score >= 40 ? 'amber' : 'teal';
  const riskLabel = (score) => score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';

  // ── Top candidate block ──
  const topCandidateHTML = top ? (() => {
    const rc = riskColor(top.suspicionScore);
    return `
      <div class="report-top-candidate">
        <div>
          <div class="report-top-candidate-label">Top Source-Association Candidate</div>
          <div class="report-top-candidate-name">${top.name || top.mmsi}</div>
          <div class="report-top-candidate-meta">MMSI ${top.mmsi} &nbsp;·&nbsp; ${top.type || '—'} &nbsp;·&nbsp; Flag: ${top.flag || top.flagCode || '—'}</div>
        </div>
        <div class="report-top-candidate-score">
          <span class="report-top-score-num score-${rc}">${top.suspicionScore}</span>
          <span class="report-top-score-denom">&thinsp;/ 100</span>
          <div><span class="report-top-score-risk risk-${rc}">${riskLabel(top.suspicionScore)}</span></div>
        </div>
      </div>`;
  })() : '';

  // ── Vessel list rows ──
  const vesselListHTML = candidates.map((v, i) => {
    const rc = riskColor(v.suspicionScore);
    const fillClass = rc === 'red' ? 'fill-red' : rc === 'amber' ? 'fill-amber' : 'fill-teal';
    const topClass  = i === 0 ? (rc === 'amber' ? 'is-top amber-top' : 'is-top') : '';
    return `
      <div class="report-vessel-item ${topClass}">
        <div>
          <div class="report-vessel-name">${v.name || v.mmsi}</div>
          <div class="report-score-bar-wrap">
            <div class="report-score-bar-bg">
              <div class="report-score-bar-fill ${fillClass}" style="width:${v.suspicionScore}%"></div>
            </div>
          </div>
        </div>
        <span class="report-vessel-mmsi">MMSI ${v.mmsi}</span>
        <span class="report-vessel-dist">${v.distanceKm != null ? `${fmtNum(v.distanceKm, 1)} km` : '—'}</span>
        <span class="report-vessel-score text-${rc}">${v.suspicionScore}/100</span>
      </div>`;
  }).join('');

  // ── Drift info ──
  const hasDrift = Array.isArray(data.driftPath) && data.driftPath.length > 0;
  const driftHTML = hasDrift
    ? `<div class="report-grid">
        <div class="report-field"><span class="report-field-label">Drift Points</span><span class="report-field-value">${data.driftPath.length} waypoints</span></div>
        <div class="report-field"><span class="report-field-label">Speed</span><span class="report-field-value">${data.driftSpeedKnots != null ? `${data.driftSpeedKnots} kn` : '—'}</span></div>
        <div class="report-field"><span class="report-field-label">Heading</span><span class="report-field-value">${data.driftHeadingDeg != null ? `${data.driftHeadingDeg}°` : '—'}</span></div>
        <div class="report-field"><span class="report-field-label">+6h Forecast</span><span class="report-field-value">${data.forecastAvailable ? 'Available' : (data.predictedPolygonGeoJSON ? 'Available' : 'Not computed')}</span></div>
        <div class="report-field"><span class="report-field-label">Wind Vector</span><span class="report-field-value">${data.windVector || '—'}</span></div>
      </div>`
    : '<p class="report-empty" style="padding:12px 0">No drift / forecast data for this incident.</p>';

  // ── Assessment text ──
  const assessHTML = top
    ? `<p class="report-assessment-text">
        Based on SAR acquisition and Lagrangian origin reconstruction, the vessel most spatially and
        temporally associated with the discharge window is <strong>${top.name || top.mmsi}</strong>
        (MMSI ${top.mmsi}), with a source-association score of
        <strong>${top.suspicionScore}/100</strong> (${riskLabel(top.suspicionScore)} risk tier).
        ${top.explanation ? `${top.explanation}` : ''}
        This assessment is based on synthetic AIS demonstration data and should not be treated as
        legal evidence or a confirmed attribution.
      </p>`
    : '<p class="report-assessment-text">No candidate vessels were identified for this incident.</p>';

  // ── Compose all sections ──
  body.innerHTML = `
    <!-- INCIDENT OVERVIEW -->
    <div class="report-section">
      <div class="report-section-header">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        Incident Overview
      </div>
      <div class="report-section-body">
        <div class="report-grid">
          <div class="report-field"><span class="report-field-label">Incident ID</span><span class="report-field-value text-cyan">${data.id}</span></div>
          <div class="report-field"><span class="report-field-label">Region</span><span class="report-field-value">${data.region || '—'}</span></div>
          <div class="report-field"><span class="report-field-label">Acquired (UTC)</span><span class="report-field-value">${data.acquiredUtc || '—'}</span></div>
          <div class="report-field"><span class="report-field-label">SAR Source</span><span class="report-field-value">${data.satellite || '—'}</span></div>
          <div class="report-field"><span class="report-field-label">Spill Area</span><span class="report-field-value">${fmtNum(data.spillAreaKm2, 2)} km²</span></div>
          <div class="report-field"><span class="report-field-label">Confidence</span><span class="report-field-value">${fmtNum(data.detectionConfidence)}%</span></div>
          <div class="report-field"><span class="report-field-label">Est. Quantity</span><span class="report-field-value">${fmtNum(oilQ.estimated_quantity_tonnes)} t &nbsp;<span style="font-size:10px;color:rgb(140,148,160)">(${fmtNum(quantityRange.min)}–${fmtNum(quantityRange.max)} t range)</span></span></div>
          <div class="report-field"><span class="report-field-label">Thickness Assumption</span><span class="report-field-value">${fmtNum(thicknessRange.min)}–${fmtNum(thicknessRange.max)} µm</span></div>
        </div>
      </div>
    </div>

    <!-- SOURCE RECONSTRUCTION -->
    <div class="report-section">
      <div class="report-section-header">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></svg>
        Source Reconstruction
      </div>
      <div class="report-section-body">
        <div class="report-grid">
          <div class="report-field"><span class="report-field-label">Origin Latitude</span><span class="report-field-value">${data.originPoint?.lat?.toFixed(5) ?? '—'}°</span></div>
          <div class="report-field"><span class="report-field-label">Origin Longitude</span><span class="report-field-value">${data.originPoint?.lng?.toFixed(5) ?? '—'}°</span></div>
          <div class="report-field"><span class="report-field-label">Uncertainty Radius</span><span class="report-field-value">${data.originPoint?.uncertaintyRadiusMeters != null ? `${(data.originPoint.uncertaintyRadiusMeters / 1000).toFixed(2)} km` : '—'}</span></div>
          <div class="report-field"><span class="report-field-label">Method</span><span class="report-field-value">Lagrangian back-propagation</span></div>
        </div>
      </div>
    </div>

    <!-- CANDIDATE VESSELS -->
    <div class="report-section">
      <div class="report-section-header">
        <svg viewBox="0 0 24 24"><path d="M3 17l4-8 5 5 3-3 4 6"/><path d="M3 21h18"/></svg>
        Candidate Vessels &nbsp;<span style="font-weight:400;color:rgb(140,148,160)">(${candidates.length})</span>
      </div>
      <div class="report-section-body">
        ${topCandidateHTML}
        ${candidates.length ? `<div class="report-vessel-list">${vesselListHTML}</div>` : '<p class="report-empty" style="padding:12px 0">No candidate vessels identified.</p>'}
      </div>
    </div>

    <!-- DRIFT & FORECAST -->
    <div class="report-section">
      <div class="report-section-header">
        <svg viewBox="0 0 24 24"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
        Drift &amp; Forecast
      </div>
      <div class="report-section-body">${driftHTML}</div>
    </div>

    <!-- FORENSIC ASSESSMENT -->
    <div class="report-section">
      <div class="report-section-header">
        <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        Forensic Assessment
      </div>
      <div class="report-section-body">${assessHTML}</div>
    </div>

    <!-- DATA & ASSUMPTIONS footer -->
    <div class="report-footer-disclaimer">
      <div class="assumptions-header">Data &amp; Assumptions</div>
      <div class="assumptions-body">
        <div class="assumption-row">
          <svg class="assumption-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <p>AIS source: Synthetic demonstration data — vessel positions and tracks are simulated and do not represent real maritime traffic.</p>
        </div>
        <div class="assumption-row">
          <svg class="assumption-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <p>Oil quantity is an estimate based on assumed film thickness. This report does not constitute a legal determination of liability.</p>
        </div>
      </div>
    </div>`;
}
