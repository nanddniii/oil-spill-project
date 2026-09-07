
import { fetchIncidentData, fetchAllIncidents } from './mockdata.js';

import { initMap } from './map.js';

import { renderVesselPanel } from './panels.js';


let currentIncidentData = null;


document.addEventListener('DOMContentLoaded', () => {
  initializeApp()
});



async function initializeApp() {
  
//   setupNavigation();

  await loadIncident('SAR-2026-0881');

//   await loadIncidentArchive();
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
