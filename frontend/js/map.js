let mapInstance = null; 
let spillLayerGroup = null;    
let originLayerGroup = null;   
let driftLayerGroup = null;    
let vesselsLayerGroup = null;  
let predictionLayerGroup = L.featureGroup();
let vesselMarkersMap = new Map();  
let vesselTracksMap = new Map();   
let currentIncident = null; 



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

// Satellite imagery is the default background for the screenshot-like view.
const satelliteMap = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles © Esri',
  maxZoom: 19
});

// OpenStreetMap is a free, open-data alternative when street labels are more useful.
const streetMap = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19
});

satelliteMap.addTo(mapInstance);

// This transparent layer adds place names and boundaries over the imagery.
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Labels © Esri',
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
vesselsLayerGroup = L.featureGroup().addTo(mapInstance);

predictionLayerGroup.addTo(mapInstance);

 renderIncidentLayers(incidentData);

  
  setupLayerToggles();

  setTimeout(() => {
    if (mapInstance) {
      mapInstance.invalidateSize();
    }
  }, 100);
}


function renderIncidentLayers(data) {
  
  spillLayerGroup.clearLayers();
  originLayerGroup.clearLayers();
  driftLayerGroup.clearLayers();
  vesselsLayerGroup.clearLayers();
  predictionLayerGroup.clearLayers();
  
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
  // Predicted +6h spill spread
  if (data.predictedPolygonGeoJSON) {
    const predictionLayer = L.geoJSON(data.predictedPolygonGeoJSON, {
      style: {
        color: '#f59e0b',
        weight: 2,
        dashArray: '6, 6',
        fillColor: '#f59e0b',
        fillOpacity: 0.20
      }
    });

    predictionLayer.bindPopup(`
      <strong>Predicted Spill Spread</strong><br>
      Forecast: +6 hours
    `);

    predictionLayerGroup.addLayer(predictionLayer);
  }


  // Candidate vessels
  data.candidates.forEach(vessel => {

    // vessel code...
    const isHighRisk = vessel.suspicionScore >= 70;
    const isMedRisk = vessel.suspicionScore >= 50 && vessel.suspicionScore < 70;
    // Vessel trajectory from AIS track history
    if (Array.isArray(vessel.trackHistory) && vessel.trackHistory.length > 1) {
      const trackColor = isHighRisk
        ? '#ff3b30'
        : isMedRisk
          ? '#f59e0b'
          : '#2563eb';

      const vesselTrack = L.polyline(vessel.trackHistory, {
        color: trackColor,
        weight: 5,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round',
        dashArray: vessel.scoreBreakdown?.aisGapDetected ? '8, 6' : null
      });

      vesselTrack.bindTooltip(`${vessel.name} trajectory`);

      vesselsLayerGroup.addLayer(vesselTrack);

      // Save it so clicking the vessel can highlight it
      vesselTracksMap.set(vessel.id, vesselTrack);
    }

    const vesselIcon = L.divIcon({
      className: 'vessel-marker',
      html: `
        <div style="
          width: 18px;
          height: 18px;
          background: #2563eb;
          border: 3px solid white;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          box-shadow: 0 2px 6px rgba(0,0,0,0.4);
        "></div>
      `,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      popupAnchor: [0, -12]
      });

    
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
  // Automatically fit map to all investigation layers
  const bounds = L.latLngBounds([]);

  // Spill polygon
  if (spillLayerGroup.getLayers().length > 0) {
    bounds.extend(spillLayerGroup.getBounds());
  }

  // Origin + uncertainty circle
  if (originLayerGroup.getLayers().length > 0) {
    bounds.extend(originLayerGroup.getBounds());
  }

  // Drift / backtracking path
  if (driftLayerGroup.getLayers().length > 0) {
    bounds.extend(driftLayerGroup.getBounds());
  }

  // Vessel trajectories and markers
  if (vesselsLayerGroup.getLayers().length > 0) {
    bounds.extend(vesselsLayerGroup.getBounds());
  }

  // Automatically zoom to all relevant investigation layers
  if (bounds.isValid()) {
    mapInstance.fitBounds(bounds, {
      padding: [50, 50],
      maxZoom: 14
    });
  }

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

export function highlightVesselOnMap(vesselId) {
  if (!mapInstance) return;

  vesselTracksMap.forEach((track, trackId) => {
    const isSelected = String(trackId) === String(vesselId);

    if (isSelected) {
      track.setStyle({
        weight: 7,
        opacity: 1
      });

      track.bringToFront();
    } else {
      track.setStyle({
        weight: 3,
        opacity: 0.15
      });
    }
  });

  const marker = vesselMarkersMap.get(vesselId);

  if (marker) {
    marker.openPopup();
    mapInstance.panTo(marker.getLatLng());
  }
}

/**
 * Reset all map highlights back to normal styling
 * Called when a vessel card is deselected
 */
export function resetMapHighlights() {
  if (!currentIncident) return;
  // Re-render all layers (restores original styles)
  renderIncidentLayers(currentIncident);
}

export function invalidateMapSize() {
  if (mapInstance) {
    setTimeout(() => {
      if (mapInstance) {
        mapInstance.invalidateSize();
        if (currentIncident && currentIncident.centerCoords) {
          mapInstance.panTo([currentIncident.centerCoords.lat, currentIncident.centerCoords.lng]);
        }
      }
    }, 80);
  }
}
