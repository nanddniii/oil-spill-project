let mapInstance = null; 
let spillLayerGroup = null;    
let originLayerGroup = null;   
let driftLayerGroup = null;    
let vesselsLayerGroup = null;  
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
    attributionControl: true 
  });

//  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
//     attribution: '&copy; OpenStreetMap contributors',
//     maxZoom: 19
//   }).addTo(mapInstance);

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
  attribution: '© Esri',
  maxZoom: 14
}).addTo(mapInstance);

L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
  attribution: '© Esri',
  maxZoom: 14
}).addTo(mapInstance);

    spillLayerGroup = L.layerGroup().addTo(mapInstance);    
  originLayerGroup = L.layerGroup().addTo(mapInstance);   
  driftLayerGroup = L.layerGroup().addTo(mapInstance);    
  vesselsLayerGroup = L.layerGroup().addTo(mapInstance);

 renderIncidentLayers(incidentData);

  
  setupLayerToggles();

}


function renderIncidentLayers(data) {
  
  spillLayerGroup.clearLayers();
  originLayerGroup.clearLayers();
  driftLayerGroup.clearLayers();
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
      <div class="popup-row"><span class="popup-label">Est. Volume:</span><span class="popup-val">${data.spillVolumeEstM3}</span></div>
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

    
    const trackPolyline = L.polyline(vessel.trackHistory, {
      color: isHighRisk ? '#ff0000' : (isMedRisk ? '#fab003' : '#0059ff'),    
      weight: isHighRisk ? 2.5 : 1.8,  
      opacity: isHighRisk ? 0.8 : 0.6, 
      
      dashArray: vessel.scoreBreakdown.aisGapDetected ? '3, 4' : null
    });
    vesselsLayerGroup.addLayer(trackPolyline);
    // Store reference in map for highlighting later
    vesselTracksMap.set(vessel.id, trackPolyline);

    
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

}

function setupLayerToggles() {
  
  const toggleSpill = document.getElementById('toggle-spill');
  const toggleOrigin = document.getElementById('toggle-origin');
  const toggleDrift = document.getElementById('toggle-drift');
  const toggleVessels = document.getElementById('toggle-vessels');

 
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
}

export function highlightVesselOnMap(vesselId) {
  if (!mapInstance) return; // Safety check

  // Update all track lines: make selected one bold, others dim
  vesselTracksMap.forEach((polyline, id) => {
    if (id === vesselId) {
      polyline.setStyle({ weight: 4, opacity: 1 });  // Bold + visible
      polyline.bringToFront();                        // Draw on top
    } else {
      polyline.setStyle({ weight: 1.5, opacity: 0.3 }); // Dim
    }
  });

  // Center map on the selected vessel and open its popup
  const marker = vesselMarkersMap.get(vesselId);
  if (marker) {
    mapInstance.panTo(marker.getLatLng());  // Smooth pan to vessel
    marker.openPopup();                     // Show vessel details popup
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
