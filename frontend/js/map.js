let mapInstance = null; 
let spillLayerGroup = null;    
let originLayerGroup = null;   
let driftLayerGroup = null;    
let predictionLayerGroup = null;
let vesselsLayerGroup = null;  
let vesselMarkersMap = new Map();  
let vesselTracksMap = new Map();   
let currentIncident = null; 
// ---------------------------------------------------------------------------
// Vessel track styling
//   candidates  -> medium-width lines in their risk colour
//   selected    -> thick, bright line with a soft white halo
//   others      -> faded while another vessel is selected
//   AIS gap     -> the silent section of the track is dashed
//   direction   -> small arrow markers along the track (oldest -> newest point)
// ---------------------------------------------------------------------------
const RISK_COLORS = {
  high: { base: '#ff0000', bright: '#ff7a7a' },
  med:  { base: '#fab003', bright: '#ffe066' },
  low:  { base: '#0059ff', bright: '#6aa5ff' }
};

const TRACK_STATES = {
  normal:   { weight: 3, opacity: 0.85, gapDash: '6, 8',   arrowSize: 13, arrowOpacity: 1 },
  faded:    { weight: 2, opacity: 0.3,  gapDash: '4, 8',   arrowSize: 13, arrowOpacity: 0.35 },
  selected: { weight: 6, opacity: 1,    gapDash: '10, 10', arrowSize: 18, arrowOpacity: 1 }
};

const MAX_ARROWS_PER_TRACK = 4;
const FADED_VESSEL_MARKER_OPACITY = 0.35;

function riskKey(score) {
  if (score >= 70) return 'high';
  if (score >= 40) return 'med';
  return 'low';
}

// Splits a track into consecutive runs of "normal" and "AIS gap" edges.
// gapRanges are [startIndex, endIndex] pairs into the track's points; the
// edges between those points are the section where the transponder was silent.
function splitAtGaps(points, gapRanges) {
  const gapEdges = new Set();
  gapRanges.forEach(([start, end]) => {
    for (let i = start; i < end; i++) gapEdges.add(i);
  });

  const segments = [];
  for (let i = 0; i < points.length - 1; i++) {
    const isGap = gapEdges.has(i);
    const last = segments[segments.length - 1];
    if (last && last.isGap === isGap) {
      last.latlngs.push(points[i + 1]);
    } else {
      segments.push({ isGap, latlngs: [points[i], points[i + 1]] });
    }
  }
  return segments;
}

// Compass bearing (0 = north, clockwise) as it appears on screen. Web Mercator
// preserves angles, so this is the same at every zoom level.
function bearingDeg(from, to) {
  const a = L.CRS.EPSG3857.project(L.latLng(from));
  const b = L.CRS.EPSG3857.project(L.latLng(to));
  return (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI;
}

// Arrows are near-white with a dark outline so they stay readable on top of
// every risk colour (a blue arrow on a blue line would disappear).
const ARROW_FILL = '#f7f9fc';

function arrowIcon(angleDeg, size) {
  return L.divIcon({
    className: 'track-arrow-icon',
    html: `<div style="width:${size}px;height:${size}px;transform:rotate(${angleDeg}deg);">
      <svg width="${size}" height="${size}" viewBox="0 0 12 12" style="display:block" fill="${ARROW_FILL}" stroke="#0a0c10" stroke-width="1">
        <polygon points="6,0.5 11,11 6,8.2 1,11"/>
      </svg>
    </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
}

// Long tracks would be cluttered with an arrow on every edge, so cap the count
// and spread the arrows evenly along the track.
function pickEvenly(items, max) {
  if (items.length <= max) return items;
  return Array.from({ length: max }, (_, k) => items[Math.floor(((k + 0.5) * items.length) / max)]);
}

function buildTrack(vessel, risk) {
  const points = vessel.trackHistory;
  const gapRanges = Array.isArray(vessel.aisGapRanges) ? vessel.aisGapRanges : [];
  const { base } = RISK_COLORS[risk];
  const normal = TRACK_STATES.normal;

  // Soft halo under the whole track; only visible while the vessel is selected.
  const halo = L.polyline(points, { color: '#ffffff', weight: 14, opacity: 0, interactive: false });
  vesselsLayerGroup.addLayer(halo);

  const segments = splitAtGaps(points, gapRanges).map(({ latlngs, isGap }) => {
    const line = L.polyline(latlngs, {
      color: base,
      weight: normal.weight,
      opacity: normal.opacity,
      lineCap: isGap ? 'butt' : 'round',
      dashArray: isGap ? normal.gapDash : null
    });
    vesselsLayerGroup.addLayer(line);
    return { line, isGap };
  });

  // One arrow at the middle of each edge, pointing in the direction of travel.
  const edges = [];

  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];

    if (a[0] !== b[0] || a[1] !== b[1]) {
      edges.push([a, b]);
    }
  }

  // Guard: if all points are identical the edges array is empty; skip arrows.
  const lastEdge = edges.length > 0 ? edges[edges.length - 1] : null;
  const arrows = lastEdge ? [lastEdge].map(([a, b]) => {
    const angle = bearingDeg(a, b);

    const marker = L.marker(
      [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      {
        icon: arrowIcon(angle, normal.arrowSize),
        interactive: false,
        keyboard: false
      }
    );

    vesselsLayerGroup.addLayer(marker);

    return {
      marker,
      icons: {
        normal: marker.options.icon,
        faded: marker.options.icon,
        selected: arrowIcon(angle, TRACK_STATES.selected.arrowSize)
      }
    };
  }) : [];

  return { risk, halo, segments, arrows };
}

// Applies the normal / faded / selected look to every track. Pass null to
// clear the selection.
function applyTrackStyles(selectedId) {
  const hasSelection = selectedId != null && vesselTracksMap.has(selectedId);

  vesselTracksMap.forEach((track, id) => {
    const state = !hasSelection ? 'normal' : (id === selectedId ? 'selected' : 'faded');
    const look = TRACK_STATES[state];
    const colors = RISK_COLORS[track.risk];
    const color = state === 'selected' ? colors.bright : colors.base;

    track.halo.setStyle({ opacity: state === 'selected' ? 0.3 : 0 });

    track.segments.forEach(({ line, isGap }) => {
      line.setStyle({
        color,
        weight: look.weight,
        opacity: look.opacity,
        dashArray: isGap ? look.gapDash : null
      });
    });

    track.arrows.forEach(({ marker, icons }) => {
      marker.setIcon(icons[state]);
      marker.setOpacity(look.arrowOpacity);
    });

    const vesselMarker = vesselMarkersMap.get(id);
    if (vesselMarker) {
      vesselMarker.setOpacity(state === 'faded' ? FADED_VESSEL_MARKER_OPACITY : 1);
    }

    if (state === 'selected') {
      track.halo.bringToFront();
      track.segments.forEach(({ line }) => line.bringToFront());
    }
  });
}



/**
 * @param {string} containerId
 */

export function initMap(containerId, incidentData) {
  
  if (mapInstance) {
    mapInstance.remove();
  }

   currentIncident = incidentData;

   const center = [incidentData.centerCoords.lat, incidentData.centerCoords.lng];

mapInstance = L.map(containerId, {
    center: center,         
    zoom: 12,               
    zoomControl: false,     
    attributionControl: true,
    preferCanvas: true
  });

  const satelliteMap = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri',
    maxZoom: 19
  }).addTo(mapInstance);
  const streetMap = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  });
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Labels &copy; Esri',
    maxZoom: 19,
    opacity: 0.9
  }).addTo(mapInstance);
  L.control.layers({
    'Satellite imagery': satelliteMap,
    'OpenStreetMap': streetMap
  }, null, { collapsed: true, position: 'bottomleft' }).addTo(mapInstance);

    spillLayerGroup = L.featureGroup().addTo(mapInstance);
  originLayerGroup = L.featureGroup().addTo(mapInstance);
  driftLayerGroup = L.featureGroup().addTo(mapInstance);
  predictionLayerGroup = L.featureGroup().addTo(mapInstance);
  vesselsLayerGroup = L.featureGroup().addTo(mapInstance);

 renderIncidentLayers(incidentData);

  
  setupLayerToggles();

  requestAnimationFrame(() => mapInstance?.invalidateSize());

}


function renderIncidentLayers(data) {
  
  spillLayerGroup.clearLayers();
  originLayerGroup.clearLayers();
  driftLayerGroup.clearLayers();
  predictionLayerGroup.clearLayers();
  vesselsLayerGroup.clearLayers();
  
  
  vesselMarkersMap.clear();
  vesselTracksMap.clear();

  
  const spillPoly = L.polygon(data.spillPolygon, {
    color: '#e89b29',       
    weight: 2,              
    fillColor: '#d9a048',   
    fillOpacity: 0.35       
  });
  

  spillPoly.bindPopup(`
    <div class="vessel-popup">
      <div class="popup-header">
        <span>SAR SPILL MASK</span>
        <span class="popup-badge badge-high">${data.detectionConfidence}% CONF</span>
      </div>
      <div class="popup-row"><span class="popup-label">Area:</span><span class="popup-val">${data.spillAreaKm2} km²</span></div>
      <div class="popup-row"><span class="popup-label">ESTIMATE tonnes:</span><span class="popup-val">${formatOilQuantity(data)}</span></div>
      <div class="popup-row"><span class="popup-label">Acquired:</span><span class="popup-val">${data.acquiredUtc}</span></div>
    </div>
  `);
  spillLayerGroup.addLayer(spillPoly);  

  
  const originLatLng = [data.originPoint.lat, data.originPoint.lng];

  
  const originCircle = L.circle(originLatLng, {
    radius: data.originPoint.uncertaintyRadiusMeters,  
    color: '#ffffff',       
    weight: 2,              
    dashArray: '8, 6',      
    fillColor: '#e8ecf0',   
    fillOpacity: 0.08       
  });
  
 
  const originIcon = L.divIcon({
    className: 'origin-target-icon',   
    html: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#e8ecf0" stroke-width="2">
      <circle cx="12" cy="12" r="10" stroke-dasharray="4,3"/>
      <circle cx="12" cy="12" r="3" fill="#e8ecf0" stroke="none"/>
    </svg>`,
    iconSize: [25, 25],     
    iconAnchor: [11, 11]    
  });
  
 
  const originMarker = L.marker(originLatLng, { icon: originIcon });
  
  
  originMarker.bindPopup(`
    <div class="vessel-popup">
      <div class="popup-header">
        <span>ESTIMATED ORIGIN</span>
        <span class="popup-badge badge-high">±${data.originPoint.uncertaintyRadiusMeters}m</span>
      </div>
      <div class="popup-row"><span class="popup-label">Latitude:</span><span class="popup-val">${data.originPoint.lat.toFixed(4)}°N</span></div>
      <div class="popup-row"><span class="popup-label">Longitude:</span><span class="popup-val">${data.originPoint.lng.toFixed(4)}°E</span></div>
      <div class="popup-row"><span class="popup-label">Wind Vector:</span><span class="popup-val">${data.windVector}</span></div>
    </div>
  `);

  originLayerGroup.addLayer(originCircle);
  originLayerGroup.addLayer(originMarker);

  if (data.predictedPolygonGeoJSON) {
    const predictionLayer = L.geoJSON(data.predictedPolygonGeoJSON, {
      style: {
        color: '#f59e0b',
        weight: 2,
        dashArray: '6, 6',
        fillColor: '#f59e0b',
        fillOpacity: 0.2
      }
    });
    predictionLayer.bindPopup('<strong>Predicted Spill Spread</strong><br>Forecast: +6 hours');
    predictionLayerGroup.addLayer(predictionLayer);
  }

 

  const driftPolyline = L.polyline(data.driftPath, {
    color: '#3fb8af',       
    weight: 3,              
    dashArray: '8, 6',      
    opacity: 0.9            
  });
  driftLayerGroup.addLayer(driftPolyline);

  
  data.candidates.forEach(vessel => {
    // Determine risk level based on suspicion score
    const isHighRisk = vessel.suspicionScore >= 70;
    const isMedRisk = vessel.suspicionScore >= 40 && vessel.suspicionScore < 70;
    
    // Color: high risk = orange-red, medium = amber, low = grey
    const vesselColor = isHighRisk ? '#ff0000' : (isMedRisk ? '#efff0a' : '#2ad300');

    
    // Track line(s), AIS-gap dashes and direction arrows (see buildTrack)
    if (Array.isArray(vessel.trackHistory) && vessel.trackHistory.length > 1) {
      vesselTracksMap.set(vessel.id, buildTrack(vessel, riskKey(vessel.suspicionScore)));
    }

    
    const vesselIcon = L.divIcon({
      className: 'vessel-marker-icon',
      html: `<div style="transform: rotate(${vessel.heading}deg); transform-origin: center;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="${vesselColor}" stroke="#0a0c10" stroke-width="1.5">
          <polygon points="12,2 18,20 12,16 6,20"/>
        </svg>
      </div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]  
    });

    
    const hasPosition = vessel.position &&
      Number.isFinite(vessel.position.lat) &&
      Number.isFinite(vessel.position.lng);
    if (!hasPosition) return;

    const marker = L.marker([vessel.position.lat, vessel.position.lng], { icon: vesselIcon });


    const badgeClass = isHighRisk ? 'badge-high' : (isMedRisk ? 'badge-med' : 'badge-low');
    
    
    marker.bindPopup(`
      <div class="vessel-popup">
        <div class="popup-header">
          <span>${vessel.name}</span>
          <span class="popup-badge ${badgeClass}">${vessel.suspicionScore}/100</span>
        </div>
        <div class="popup-row"><span class="popup-label">MMSI:</span><span class="popup-val">${vessel.mmsi}</span></div>
        <div class="popup-row"><span class="popup-label">Type:</span><span class="popup-val">${vessel.type}</span></div>
        
        <div class="popup-row"><span class="popup-label">AIS Gap:</span><span class="popup-val" style="color: ${vessel.scoreBreakdown.aisGapDetected ? '#ff0000' : '#2ad300'}">${vessel.scoreBreakdown.aisGapDetected ? 'YES (' + vessel.scoreBreakdown.aisGapDurationMins + 'm)' : 'NO'}</span></div>
      </div>
    `);

    vesselsLayerGroup.addLayer(marker);
    vesselMarkersMap.set(vessel.id, marker);
  });

  const bounds = L.latLngBounds([]);
  [spillLayerGroup, originLayerGroup, driftLayerGroup, predictionLayerGroup, vesselsLayerGroup]
    .forEach((layerGroup) => {
      if (layerGroup.getLayers().length > 0) bounds.extend(layerGroup.getBounds());
    });
  if (bounds.isValid()) mapInstance.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });

}

function formatOilQuantity(data) {
  const estimate = data.oilQuantityEstimate || {};
  const range = estimate.quantity_range_tonnes || {};
  if (!Number.isFinite(Number(range.min)) || !Number.isFinite(Number(range.max))) {
    return 'Unavailable';
  }
  return `${Number(range.min).toLocaleString()}-${Number(range.max).toLocaleString()} tonnes`;
}

function setupLayerToggles() {
  
  const toggleSpill = document.getElementById('toggle-spill');
  const toggleOrigin = document.getElementById('toggle-origin');
  const toggleDrift = document.getElementById('toggle-drift');
  const toggleVessels = document.getElementById('toggle-vessels');
  const togglePrediction = document.getElementById('toggle-prediction');

 
  if (toggleSpill) {
    toggleSpill.addEventListener('change', (e) => {
      if (e.target.checked) mapInstance.addLayer(spillLayerGroup);
      else mapInstance.removeLayer(spillLayerGroup);
    });
  }
  if (toggleOrigin) {
    toggleOrigin.addEventListener('change', (e) => {
      if (e.target.checked) mapInstance.addLayer(originLayerGroup);
      else mapInstance.removeLayer(originLayerGroup);
    });
  }
  if (toggleDrift) {
    toggleDrift.addEventListener('change', (e) => {
      if (e.target.checked) mapInstance.addLayer(driftLayerGroup);
      else mapInstance.removeLayer(driftLayerGroup);
    });
  }
  if (toggleVessels) {
    toggleVessels.addEventListener('change', (e) => {
      if (e.target.checked) mapInstance.addLayer(vesselsLayerGroup);
      else mapInstance.removeLayer(vesselsLayerGroup);
    });
  }
  if (togglePrediction) {
    togglePrediction.addEventListener('change', (e) => {
      if (e.target.checked) mapInstance.addLayer(predictionLayerGroup);
      else mapInstance.removeLayer(predictionLayerGroup);
    });
  }
}

// Leaflet doesn't notice when its container is hidden and shown again (e.g.
// switching between the Dashboard and Incidents Archive views).
export function refreshMapSize() {
  if (mapInstance) mapInstance.invalidateSize();
}

export function highlightVesselOnMap(vesselId) {
  if (!mapInstance) return; // Safety check

  // Selected track: thick + bright. Every other track: faded.
  applyTrackStyles(vesselId);

  // Center map on the selected vessel and open its popup
  const marker = vesselMarkersMap.get(vesselId);
  if (marker) {
    mapInstance.panTo(marker.getLatLng());  // Smooth pan to vessel
    marker.openPopup();                     // Show vessel details popup
  }
}

/**
 * Clear the selection: every track goes back to its normal look.
 * Called when a vessel card is deselected.
 */
export function resetMapHighlights() {
  if (!mapInstance) return;
  applyTrackStyles(null);
}
