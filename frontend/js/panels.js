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

  
  sorted.forEach((vessel, idx) => {
    
    const isHigh = vessel.suspicionScore >= 70;
    const isMed = vessel.suspicionScore >= 40 && vessel.suspicionScore < 70;
    
    const barColorClass = isHigh ? 'score-red' : (isMed ? 'score-amber' : 'score-teal');
    const borderClass = isHigh ? 'high-suspicion' : (isMed ? 'med-suspicion' : 'low-suspicion');
    const scoreColorClass = isHigh ? 'text-red' : (isMed ? 'text-amber' : 'text-cyan');
    
    const score = vessel.suspicionScore;
    const distance = vessel.distanceKm != null ? vessel.distanceKm : '-';
    const risk = vessel.riskLevel || '-';
    const confidence = vessel.confidence != null
      ? `${Math.round(vessel.confidence * 100)}%`
      : '-';
    const heading = vessel.heading != null ? `${vessel.heading}°` : '-';

    // Create the card DOM element
    const card = document.createElement('div');
    // Top candidate expanded and active by default to match dashboard view
    const isDefaultExpanded = idx === 0;
    card.className = `vessel-card ${borderClass}${isDefaultExpanded ? ' expanded active' : ''}`;  
    card.id = `vessel-card-${vessel.id}`;

    if (isDefaultExpanded && !activeSelectedVesselId) {
      activeSelectedVesselId = vessel.id;
    }

    // Fill the card with HTML content matching screenshot 3
    card.innerHTML = `
      <!-- Main visible section (always shown) -->
      <div class="vessel-card-main">
        <div class="vessel-card-header">
          <div class="vessel-name-wrap">
            <span class="vessel-name">${vessel.name}</span>
            <span class="vessel-flag-badge">${vessel.flagCode}</span>
          </div>
          <span class="vessel-score-badge ${scoreColorClass}">
            ${score}/100
          </span>
        </div>
        
        <!-- Vessel metadata line -->
        <div class="vessel-meta">
          <span>MMSI: ${vessel.mmsi}</span>
          <span>•</span>
          <span>${distance} km</span>
          <span>•</span>
          <span>Risk: ${risk}</span>
        </div>
        
        <!-- Full-width score progress bar -->
        <div class="score-bar-wrapper">
          <div class="score-bar-bg">
            <div class="score-bar-fill ${barColorClass}" style="width: ${vessel.suspicionScore}%;"></div>
          </div>
        </div>
      </div>

      <!-- Expandable details section (2x3 grid + explanation) -->
      <div class="vessel-card-details">
        <div class="factor-grid">
          <div class="factor-item">
            <span class="factor-label">PROXIMITY INDEX</span>
            <span class="factor-val">${vessel.scoreBreakdown.proximityScore}%</span>
          </div>
          <div class="factor-item">
            <span class="factor-label">TRAJECTORY MATCH</span>
            <span class="factor-val">${vessel.scoreBreakdown.trajectoryMatchScore}%</span>
          </div>
          <div class="factor-item">
            <span class="factor-label">CONFIDENCE</span>
            <span class="factor-val">${confidence}</span>
          </div>
          <div class="factor-item">
            <span class="factor-label">HEADING</span>
            <span class="factor-val">${heading}</span>
          </div>
          <div class="factor-item">
            <span class="factor-label">AIS SIGNAL GAP</span>
            <span class="flag-tag ${vessel.scoreBreakdown.aisGapDetected ? 'flag-alert' : 'flag-ok'}">
              ${vessel.scoreBreakdown.aisGapDetected ? 'Detected (' + vessel.scoreBreakdown.aisGapDurationMins + 'm)' : 'None'}
            </span>
          </div>
          <div class="factor-item">
            <span class="factor-label">SPEED CHANGE</span>
            <span class="flag-tag ${vessel.scoreBreakdown.speedAnomalyDetected ? 'flag-alert' : 'flag-ok'}">
              ${vessel.scoreBreakdown.speedAnomalyDetected ? 'Flagged' : 'Normal'}
            </span>
          </div>
        </div>
        
        <!-- Explanation of vessel suspicion -->
        <div class="vessel-explanation">
          ${vessel.explanation}
        </div>
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
