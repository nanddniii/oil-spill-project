import { initMap } from './map.js';

const evidenceFactors = [
  ['Distance Score', 'distanceScore'], ['Time Score', 'timeScore'],
  ['Trajectory Score', 'trajectoryScore'], ['Presence Score', 'presenceScore'],
  ['AIS Anomaly Score', 'aisAnomalyScore'], ['Speed Score', 'speedScore'],
  ['Vessel Type Score', 'vesselTypeScore']
];

export function renderForensicReport(data) {
  const container = document.getElementById('forensic-report-content');
  if (!container || !data) return;

  container.innerHTML = `
    <div class="report-grid">
      ${renderSection('Incident Information', renderRows([
        ['Incident ID', data.id], ['Detection Timestamp', data.acquiredUtc],
        ['Generated Timestamp', new Date().toISOString()], ['Investigation Status', 'Evidence review']
      ]))}
      ${renderSection('SAR Observation', renderRows([
        ['Spill Detected', 'Confirmed'], ['Detection Confidence', `${format(data.detectionConfidence)}%`],
        ['Spill Area', `${format(data.spillAreaKm2)} km²`], ['Satellite Source', data.satellite],
        ['Observation Time', data.acquiredUtc]
      ]))}
      ${renderSection('Spill Estimation', renderRows([
        ['Estimated Spill Area', `${format(data.spillAreaKm2)} km²`],
        ['Estimated Oil Quantity Range', formatQuantity(data)],
        ['Origin Latitude', `${format(data.originPoint?.lat, 5)}°`],
        ['Origin Longitude', `${format(data.originPoint?.lng, 5)}°`],
        ['Uncertainty Radius', `${format(Number(data.originPoint?.uncertaintyRadiusMeters) / 1000)} km`]
      ]))}
      ${renderSection('Drift / Source Reconstruction', renderRows([
        ['Estimated Origin', `${format(data.originPoint?.lat, 5)}°, ${format(data.originPoint?.lng, 5)}°`],
        ['Backward Drift Summary', data.driftPath?.length ? `${data.driftPath.length} reconstructed waypoints` : 'Available from origin estimate'],
        ['Drift Confidence', `${format(data.detectionConfidence)}%`], ['Forecast Summary', data.predictedPolygonGeoJSON ? '+6 hour spread available' : 'Unavailable']
      ]))}
    </div>
    <section class="report-section report-map-section">
      <div class="report-section-heading"><h2>Map Section</h2><span>Spill polygon · origin · candidate vessel tracks · uncertainty radius</span></div>
      <div id="report-map" class="report-map"></div>
    </section>
    <section class="report-section">
      <div class="report-section-heading"><h2>Candidate Vessels</h2><span>Ranked source association evidence</span></div>
      <div class="report-table-wrap"><table class="report-table"><thead><tr><th>Rank</th><th>Vessel Name</th><th>MMSI</th><th>Score</th><th>Risk</th><th>Confidence</th><th>Distance</th><th>Time Difference</th></tr></thead><tbody>${data.candidates.map((vessel, index) => renderVesselRow(vessel, index + 1)).join('')}</tbody></table></div>
    </section>
  `;

  container.querySelectorAll('.report-vessel-row').forEach((row) => {
    row.addEventListener('click', () => row.classList.toggle('expanded'));
  });
  initMap('report-map', data);
}

function renderVesselRow(vessel, rank) {
  const confidence = vessel.confidence == null ? '-' : `${Math.round(Number(vessel.confidence) * 100)}%`;
  return `<tr class="report-vessel-row" tabindex="0"><td>${rank}</td><td><strong>${escapeHtml(vessel.name)}</strong><small>Candidate Vessel</small></td><td>${escapeHtml(vessel.mmsi)}</td><td><span class="score-badge">${format(vessel.suspicionScore)}/100</span></td><td><span class="risk-badge risk-${String(vessel.riskLevel).toLowerCase()}">${escapeHtml(vessel.riskLevel || '-')}</span></td><td>${confidence}</td><td>${format(vessel.distanceKm)} km</td><td>${format(vessel.timeDifferenceMinutes)} min</td></tr><tr class="report-vessel-details"><td colspan="8">${renderEvidence(vessel)}</td></tr>`;
}

function renderEvidence(vessel) {
  const breakdown = vessel.scoreBreakdown || {};
  const reasons = Array.isArray(vessel.reasons) ? vessel.reasons : [];
  return `<div class="evidence-detail"><div><h3>Source Association Evidence</h3><div class="evidence-bars">${evidenceFactors.map(([label, key]) => renderBar(label, breakdown[key])).join('')}</div></div><div><h3>Investigation Evidence</h3><dl class="evidence-facts">${renderFact('Distance from Origin', `${format(vessel.distanceKm)} km`)}${renderFact('Time Difference', `${format(vessel.timeDifferenceMinutes)} minutes`)}${renderFact('Trajectory Alignment', `${format(Number(vessel.trajectoryAlignment) * 100)}%`)}${renderFact('Movement Direction', vessel.movementDirection || '-')} ${renderFact('AIS Anomalies', vessel.aisAnomalies?.length ? `${vessel.aisAnomalies.length} gap(s)` : 'None')}${renderFact('Vessel Type', vessel.type || '-')}${renderFact('Speed', vessel.speedKnots === '' ? '-' : `${format(vessel.speedKnots)} knots`)}</dl></div><div><h3>Evidence Reasons</h3><ul class="evidence-reasons">${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('') || '<li>No reasons returned by backend.</li>'}</ul></div></div>`;
}

function renderBar(label, value) { const score = Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : 0; return `<div class="evidence-bar"><div><span>${label}</span><b>${format(value)}</b></div><div class="evidence-bar-track"><i style="width:${score}%"></i></div></div>`; }
function renderSection(title, content) { return `<section class="report-section"><div class="report-section-heading"><h2>${title}</h2></div>${content}</section>`; }
function renderRows(rows) { return `<div class="report-rows">${rows.map(([label, value]) => `<div><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>`; }
function renderFact(label, value) { return `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`; }
function format(value, digits = 2) { return Number.isFinite(Number(value)) ? Number(value).toLocaleString(undefined, { maximumFractionDigits: digits }) : '-'; }
function formatQuantity(data) { const range = data.oilQuantity?.quantity_range_tonnes || {}; return Number.isFinite(Number(range.min)) ? `${format(range.min)}-${format(range.max)} tonnes` : data.spillVolumeEstM3 || 'Unavailable'; }
function escapeHtml(value) { return String(value ?? '-').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }

export function setupReportActions() {
  document.getElementById('print-report')?.addEventListener('click', () => window.print());
  document.getElementById('save-report')?.addEventListener('click', () => {
    const report = document.getElementById('forensic-report-content')?.innerText || '';
    const blob = new Blob([report], { type: 'text/plain' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'forensic-report.txt'; link.click(); URL.revokeObjectURL(link.href);
  });
  document.getElementById('export-report')?.addEventListener('click', () => window.print());
}