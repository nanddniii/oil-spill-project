import { highlightVesselOnMap } from './map.js';


let activeSelectedVesselId = null;

export function renderVesselPanel(incidentData) {
  
  renderIncidentSummary(incidentData);

  
  renderCandidateList(incidentData.candidates);

  
  const lastUpdated = document.getElementById('last-updated');
  if (lastUpdated) {
    const val = lastUpdated.querySelector('.data-value');
    if (val) {
      
      val.textContent = incidentData.acquiredUtc || '-';
    }
  }
}


function renderIncidentSummary(data) {
  
  const container = document.getElementById('incident-summary-rows');
  if (!container) return; 

  const oilQuantity = data.oilQuantity || data.oilQuantityEstimate || {};
  const quantityRange = oilQuantity.quantity_range_tonnes || {};
  const thicknessRange = oilQuantity.thickness_range_microns || {};
  
  container.innerHTML = `
    <div class="data-row">
      <span class="data-label">Incident ID</span>
      <span class="data-value text-cyan">${data.id}</span>
    </div>
    <div class="data-row">
      <span class="data-label">Region</span>
      <span class="data-value">${data.region}</span>
    </div>
    <div class="data-row">
      <span class="data-label">Detected</span>
      <span class="data-value">${data.acquiredUtc}</span>
    </div>
    <div class="data-row">
      <span class="data-label">Spill area</span>
      <span class="data-value">${data.spillAreaKm2} km²</span>
    </div>
    <div class="data-row">
      <span class="data-label">Estimated Oil Quantity (tonnes)</span>
      <span class="data-value">${formatNumber(oilQuantity.estimated_quantity_tonnes)} tonnes</span>
    </div>
    <div class="data-row">
      <span class="data-label">Estimated Range (tonnes)</span>
      <span class="data-value">${formatNumber(quantityRange.min)}-${formatNumber(quantityRange.max)} tonnes</span>
    </div>
    <div class="data-row">
      <span class="data-label">Thickness Assumption</span>
      <span class="data-value">${formatNumber(thicknessRange.min)}-${formatNumber(thicknessRange.max)} µm</span>
    </div>
    <div class="data-row">
      <span class="data-label">Confidence</span>
      <div class="confidence-bar-container">
        <!-- Mini progress bar showing confidence percentage -->
        <div class="mini-bar">
          <div class="mini-bar-fill" style="width: ${data.detectionConfidence}%;"></div>
        </div>
        <span class="data-value text-cyan">${data.detectionConfidence}%</span>
      </div>
    </div>
  `;
}

function formatNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 }) : '-';
}


function renderCandidateList(candidates) {
  
  const container = document.getElementById('vessel-candidate-list');
  if (!container) return; 

  
  const sorted = [...candidates].sort((a, b) => b.suspicionScore - a.suspicionScore);

  
  container.innerHTML = '';

  
  sorted.forEach(vessel => {
    
    const isHigh = vessel.suspicionScore >= 70;
    const isMed = vessel.suspicionScore >= 40 && vessel.suspicionScore < 70;
    
    
    const barColorClass = isHigh ? 'score-red' : (isMed ? 'score-amber' : 'score-teal');
    
    
    const borderClass = isHigh ? 'high-suspicion' : (isMed ? 'med-suspicion' : 'low-suspicion');
    
    
    const scoreColorClass = isHigh ? 'text-red' : (isMed ? 'text-amber' : 'text-cyan');
    const score = vessel.suspicionScore;
    const distance = vessel.distanceKm ?? '-';
    const risk = vessel.riskLevel ?? '-';
    const confidence = vessel.confidence != null
      ? `${Math.round(vessel.confidence * 100)}%`
      : '-';
    const heading = vessel.heading ?? '-';

    // Create the card DOM element
    const card = document.createElement('div');
    card.className = `vessel-card ${borderClass}`;  
    card.id = `vessel-card-${vessel.id}`;           // Unique ID for targeting

    // Fill the card with HTML content
    card.innerHTML = `
      <!-- Main visible section (always shown) -->
      <div class="vessel-card-main">
        <div class="vessel-card-header">
          <!-- Vessel name + flag code -->
          <span class="vessel-name">
            ${vessel.name}
            <span class="text-dim" style="font-size: 10px; font-weight: normal;">${vessel.flagCode}</span>
          </span>
          <!-- Suspicion score badge (colored by risk level) -->
          <span class="vessel-score-badge ${scoreColorClass}">
            ${score}/100
          </span>
        </div>
        
        <!-- Vessel metadata line (MMSI, type, speed) -->
        <div class="vessel-meta">
          <span>MMSI: ${vessel.mmsi}</span>
          <span>•</span>
          <span>${distance} km</span>
          <span>•</span>
          <span>Risk: ${risk}</span>
        </div>
        
        <!-- Score bar — proportional visual representation of suspicion score -->
        <div class="score-bar-wrapper">
          <div class="score-bar-bg">
            <div class="score-bar-fill ${barColorClass}" style="width: ${vessel.suspicionScore}%;"></div>
          </div>
        </div>
      </div>

      <!-- Expandable details section (shown when card is clicked) -->
      <div class="vessel-card-details">
        <div class="evidence-card-heading">
          <div><span class="factor-label">Investigation Evidence</span><strong>Source Association Evidence</strong></div>
          <span class="risk-badge risk-${String(risk).toLowerCase()}">${risk}</span>
        </div>
        <div class="evidence-card-summary">
          <div><span class="factor-label">Attribution Score</span><strong>${score}/100</strong></div>
          <div><span class="factor-label">Confidence</span><strong>${confidence}</strong></div>
        </div>
        <div class="evidence-bars">
          ${renderEvidenceBar('Distance Score', vessel.scoreBreakdown.distanceScore)}
          ${renderEvidenceBar('Time Score', vessel.scoreBreakdown.timeScore)}
          ${renderEvidenceBar('Trajectory Score', vessel.scoreBreakdown.trajectoryScore)}
          ${renderEvidenceBar('Presence Score', vessel.scoreBreakdown.presenceScore)}
          ${renderEvidenceBar('AIS Anomaly Score', vessel.scoreBreakdown.aisAnomalyScore)}
          ${renderEvidenceBar('Speed Score', vessel.scoreBreakdown.speedScore)}
          ${renderEvidenceBar('Vessel Type Score', vessel.scoreBreakdown.vesselTypeScore)}
        </div>
        <div class="evidence-facts">
          <div><span>Distance from Origin</span><strong>${distance} km</strong></div>
          <div><span>Time Difference</span><strong>${vessel.timeDifferenceMinutes ?? '-'} minutes</strong></div>
          <div><span>Trajectory Alignment</span><strong>${vessel.scoreBreakdown.trajectoryScore ?? '-'}%</strong></div>
          <div><span>Movement Direction</span><strong>${vessel.movementDirection || heading || '-'}</strong></div>
          <div><span>AIS Anomalies</span><strong>${vessel.scoreBreakdown.aisGapDetected ? `Detected (${vessel.scoreBreakdown.aisGapDurationMins} min)` : 'None'}</strong></div>
          <div><span>Vessel Type</span><strong>${vessel.type || '-'}</strong></div>
          <div><span>Speed</span><strong>${vessel.speedKnots === '' ? '-' : `${vessel.speedKnots} knots`}</strong></div>
        </div>
        <div class="vessel-explanation"><span class="factor-label">Evidence Reasons</span><ul>${renderReasons(vessel)}</ul></div>
      </div>
    `;

    // Add click event handler for expanding/collapsing the card
    card.addEventListener('click', () => {
      handleVesselCardClick(vessel.id, card);
    });

    // Add the card to the container in the DOM
    container.appendChild(card);
  });
}

function renderEvidenceBar(label, value) {
  const score = Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : 0;
  return `<div class="evidence-bar"><div><span>${label}</span><b>${Number.isFinite(Number(value)) ? Number(value) : '-'}</b></div><div class="evidence-bar-track"><i style="width: ${score}%;"></i></div></div>`;
}

function renderReasons(vessel) {
  const reasons = Array.isArray(vessel.reasons) ? vessel.reasons : [];
  if (reasons.length > 0) return reasons.map(reason => `<li>${reason}</li>`).join('');
  return vessel.explanation ? `<li>${vessel.explanation}</li>` : '<li>No reasons returned by backend.</li>';
}


function handleVesselCardClick(vesselId, cardElement) {
  // Check if this card is already expanded
  const isAlreadyExpanded = cardElement.classList.contains('expanded');

  // Collapse ALL cards first (only one can be expanded at a time)
  document.querySelectorAll('.vessel-card').forEach(c => {
    c.classList.remove('expanded');  // Hide the details section
    c.classList.remove('active');    // Remove active border styling
  });

  if (!isAlreadyExpanded) {
    
    cardElement.classList.add('expanded');  // Show details section (CSS: display: block)
    cardElement.classList.add('active');    // Add cyan border highlighting
    activeSelectedVesselId = vesselId;
    
   
    highlightVesselOnMap(vesselId);
  } else {
   
    activeSelectedVesselId = null;
    
  }
}
