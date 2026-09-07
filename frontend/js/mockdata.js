const INCIDENT_DATABASE = {
  'SAR-2026-0881': {
    id: 'SAR-2026-0881',
    title: 'North Sea Sector 4 Oil Discharge',
    satellite: 'Sentinel-1A (SAR-C EW Mode)',
    acquiredUtc: '2026-08-25 14:22:09 UTC',
    region: 'North Sea / Dover Strait Traffic Separation Scheme',
    centerCoords: { lat: 51.462, lng: 2.128 },
    spillAreaKm2: 4.82,
    spillLengthNm: 3.4,
    spillVolumeEstM3: '140 - 180 m³',
    detectionConfidence: 94.2,
    driftSpeedKnots: 1.25,
    driftHeadingDeg: 220,
    windVector: '14 kn @ 045° (NE)',
    
    // Spill polygon: Array of [lat, lng] coordinate pairs defining the oil slick boundary
    // These points form a closed polygon on the Leaflet map
    spillPolygon: [
      [51.468, 2.115],
      [51.472, 2.125],
      [51.469, 2.140],
      [51.460, 2.152],
      [51.452, 2.148],
      [51.455, 2.130],
      [51.462, 2.118]
    ],

    // Origin estimation: Where the spill likely started
    // uncertaintyRadiusMeters: the circle of uncertainty around the estimated origin
    originPoint: {
      lat: 51.4715,
      lng: 2.1270,
      uncertaintyRadiusMeters: 850
    },

    // Drift path: Waypoints showing how the oil drifted over time
    // [0] = origin (T-0), last element = where oil was at SAR acquisition time
    driftPath: [
      [51.4715, 2.1270], // T-0 (Origin)
      [51.4650, 2.1330], // T-3h (3 hours after origin)
      [51.4590, 2.1390], // T-6h (6 hours after origin)
      [51.4530, 2.1460]  // T-9h (SAR acquisition time)
    ],

   

    // Candidate vessels: Array of ship objects ranked by suspicion score
    // Sorted descending (highest suspicion first) in vesselPanel.js
    candidates: [
      {
        id: 'vessel-001',
        mmsi: '244780112',           // Maritime Mobile Service Identity (unique ship radio ID)
        imo: '9482103',              // International Maritime Organization number (permanent ship ID)
        name: 'MV NORDIC GEMINI',
        flag: 'Netherlands',
        flagCode: 'NL',              // 2-letter country code
        type: 'Crude Oil Tanker',    // Vessel type (affects suspicion weighting)
        length: 274,                 // Ship length in meters
        beam: 48,                    // Ship width in meters
        draft: 14.8,                 // How deep the ship sits in water (meters)
        speedKnots: 12.4,            // Current speed in knots
        courseDeg: 215,              // Current course in degrees (compass bearing)
        destination: 'ROTTERDAM -> AUGUSTA',
        suspicionScore: 88,          // Overall suspicion score (0-100)
        position: { lat: 51.442, lng: 2.095 },  // Current position
        heading: 215,                // Heading direction (for rotated marker icon)
        // Track history: Array of [lat, lng] waypoints showing the vessel's path
        trackHistory: [
          [51.498, 2.165],
          [51.478, 2.135],  // Near origin point
          [51.465, 2.120],  // AIS gap starts here
          [51.442, 2.095]   // Current position
        ],
        scoreBreakdown: {
          proximityScore: 94,         // How close to origin (0-100)
          trajectoryMatchScore: 85,   // Heading alignment with spill (0-100)
          aisGapDetected: true,       // Was AIS transponder off?
          aisGapDurationMins: 42,     // How long was AIS off (minutes)
          speedAnomalyDetected: true, // Did speed change suspiciously?
          speedDropKnots: '14.1 kn -> 3.2 kn'  // Speed change description
        },
        // Plain-English explanation of why this vessel is suspicious
        explanation: 'Vessel transited within 0.8nm of estimated origin point at 11:40 UTC. AIS transponder silent for 42 minutes during origin window. Speed dropped to 3.2 kn during blackout period consistent with tank washing / bilgewater discharge operations.'
      },
      {
        id: 'vessel-002',
        mmsi: '563091000', imo: '9310022',
        name: 'OCEAN TRADER V',
        flag: 'Singapore', flagCode: 'SG',
        type: 'Chemical Tanker',
        length: 182, beam: 32, draft: 11.2,
        speedKnots: 11.1, courseDeg: 210,
        destination: 'ANTWERP -> HOUSTON',
        suspicionScore: 64,
        position: { lat: 51.435, lng: 2.070 },
        heading: 210,
        trackHistory: [
          [51.510, 2.190],
          [51.485, 2.150],
          [51.460, 2.110],
          [51.435, 2.070]
        ],
        scoreBreakdown: {
          proximityScore: 72,
          trajectoryMatchScore: 68,
          aisGapDetected: false,
          aisGapDurationMins: 0,
          speedAnomalyDetected: true,
          speedDropKnots: 'Unscheduled 18° course change'
        },
        explanation: 'Crossed drift trajectory 1.4 hours prior to SAR acquisition. Course altered 18° without destination update. AIS signal was continuous.'
      },
      {
        id: 'vessel-003',
        mmsi: '211445000', imo: '9154388',
        name: 'BALTIC EXPLORER',
        flag: 'Germany', flagCode: 'DE',
        type: 'Container Ship',
        length: 334, beam: 42, draft: 13.5,
        speedKnots: 18.2, courseDeg: 45,
        destination: 'HAMBURG -> BREMERHAVEN',
        suspicionScore: 38,
        position: { lat: 51.520, lng: 2.210 },
        heading: 45,
        trackHistory: [
          [51.430, 2.050],
          [51.465, 2.110],
          [51.490, 2.160],
          [51.520, 2.210]
        ],
        scoreBreakdown: {
          proximityScore: 45,
          trajectoryMatchScore: 30,
          aisGapDetected: false,
          aisGapDurationMins: 0,
          speedAnomalyDetected: false,
          speedDropKnots: 'None'
        },
        explanation: 'Transited 3.2nm upwind of estimated origin. Maintained steady speed (18.2 kn) and course. Container vessel type presents lower risk profile for unrefined oil discharges.'
      },
      {
        id: 'vessel-004',
        mmsi: '311000452', imo: '9600114',
        name: 'SEAWING TITAN',
        flag: 'Bahamas', flagCode: 'BS',
        type: 'Bulk Carrier',
        length: 225, beam: 32, draft: 12.0,
        speedKnots: 10.5, courseDeg: 220,
        destination: 'DUNKIRK -> TUBARAO',
        suspicionScore: 22,
        position: { lat: 51.410, lng: 2.030 },
        heading: 220,
        trackHistory: [
          [51.470, 2.170],
          [51.440, 2.100],
          [51.410, 2.030]
        ],
        scoreBreakdown: {
          proximityScore: 25,
          trajectoryMatchScore: 18,
          aisGapDetected: false,
          aisGapDurationMins: 0,
          speedAnomalyDetected: false,
          speedDropKnots: 'None'
        },
        explanation: 'Followed standard commercial shipping lane. Distance to spill origin exceeded 5.5nm at all times.'
      },
      {
        id: 'vessel-005',
        mmsi: '235089110', imo: '9411995',
        name: 'STOLT RESOLUTE',
        flag: 'United Kingdom', flagCode: 'GB',
        type: 'Products Tanker',
        length: 165, beam: 26, draft: 9.4,
        speedKnots: 13.0, courseDeg: 38,
        destination: 'LE HAVRE -> IMMINGHAM',
        suspicionScore: 14,
        position: { lat: 51.530, lng: 2.250 },
        heading: 38,
        trackHistory: [
          [51.450, 2.080],
          [51.490, 2.160],
          [51.530, 2.250]
        ],
        scoreBreakdown: {
          proximityScore: 15,
          trajectoryMatchScore: 12,
          aisGapDetected: false,
          aisGapDurationMins: 0,
          speedAnomalyDetected: false,
          speedDropKnots: 'None'
        },
        explanation: 'Transited south of target zone. Zero spatial-temporal intersection with back-propagated spill vector field.'
      },
      {
        id: 'vessel-006',
        mmsi: '477123900', imo: '9287766',
        name: 'ALTAIR STAR',
        flag: 'Hong Kong', flagCode: 'HK',
        type: 'Crude Oil Tanker',
        length: 333, beam: 60, draft: 21.0,
        speedKnots: 0.2, courseDeg: 90,
        destination: 'ANCHORAGE ZONE 4',
        suspicionScore: 9,
        position: { lat: 51.545, lng: 2.020 },
        heading: 90,
        trackHistory: [
          [51.545, 2.020],
          [51.545, 2.020]
        ],
        scoreBreakdown: {
          proximityScore: 10,
          trajectoryMatchScore: 8,
          aisGapDetected: false,
          aisGapDurationMins: 0,
          speedAnomalyDetected: false,
          speedDropKnots: 'None'
        },
        explanation: 'Stationary in designated offshore anchorage zone 12nm west. No auxiliary engine anomalies or displacement recorded.'
      }
    ]
  },

  'SAR-2026-0879': {
    id: 'SAR-2026-0879',
    title: 'Strait of Dover South Channel Discharge',
    satellite: 'Sentinel-1B (SAR-C IW Mode)',
    acquiredUtc: '2026-08-24 06:14:30 UTC',
    region: 'English Channel / Dover Strait South',
    centerCoords: { lat: 51.120, lng: 1.640 },
    spillAreaKm2: 2.15,
    spillLengthNm: 1.8,
    spillVolumeEstM3: '65 - 90 m³',
    detectionConfidence: 89.5,
    driftSpeedKnots: 0.9,
    driftHeadingDeg: 195,
    windVector: '10 kn @ 015°',
    spillPolygon: [
      [51.125, 1.630],
      [51.128, 1.645],
      [51.118, 1.650],
      [51.112, 1.635]
    ],
    originPoint: { lat: 51.127, lng: 1.642, uncertaintyRadiusMeters: 600 },
    driftPath: [
      [51.127, 1.642],
      [51.120, 1.640]
    ],
    pipelineTimeline: [
      { id: 1, stage: 'SAR Frame Ingestion', timestamp: '06:14:35 UTC', status: 'completed', desc: 'Sentinel-1B frame processed.' },
      { id: 2, stage: 'U-Net Neural Segmentation', timestamp: '06:15:10 UTC', status: 'completed', desc: 'Spill boundary extracted.' },
      { id: 3, stage: 'Lagrangian Drift Back-prop', timestamp: '06:15:40 UTC', status: 'completed', desc: 'Origin window computed.' },
      { id: 4, stage: 'AIS Spatial-Temporal Cross-ref', timestamp: '06:16:05 UTC', status: 'completed', desc: '4 candidates cross-referenced.' },
      { id: 5, stage: 'Candidate Suspicion Scoring', timestamp: '06:16:30 UTC', status: 'completed', desc: 'Analysis completed.' }
    ],
    candidates: [
      {
        id: 'vessel-101',
        mmsi: '636018223',
        imo: '9543110',
        name: 'CAPTAIN VASSILIS',
        flag: 'Liberia',
        flagCode: 'LR',
        type: 'Crude Oil Tanker',
        length: 250,
        beam: 44,
        draft: 13.2,
        speedKnots: 11.8,
        courseDeg: 200,
        destination: 'ROTTERDAM -> FOS',
        suspicionScore: 79,
        position: { lat: 51.100, lng: 1.610 },
        heading: 200,
        trackHistory: [
          [51.140, 1.660],
          [51.125, 1.640],
          [51.100, 1.610]
        ],
        scoreBreakdown: {
          proximityScore: 88,
          trajectoryMatchScore: 78,
          aisGapDetected: true,
          aisGapDurationMins: 28,
          speedAnomalyDetected: false,
          speedDropKnots: 'None'
        },
        explanation: 'Transited origin point with a 28-minute AIS signal drop. High temporal correlation.'
      }
    ]
  }
};


export async function fetchIncidentData(incidentId = 'SAR-2026-0881') {
  
  const data = INCIDENT_DATABASE[incidentId] || INCIDENT_DATABASE['SAR-2026-0881'];
  return JSON.parse(JSON.stringify(data));
}

export async function fetchAllIncidents() {

  return Object.values(INCIDENT_DATABASE).map(inc => ({
    id: inc.id,
    title: inc.title,
    satellite: inc.satellite,
    acquiredUtc: inc.acquiredUtc,
    spillAreaKm2: inc.spillAreaKm2,
    detectionConfidence: inc.detectionConfidence,
    highestSuspicionScore: Math.max(...inc.candidates.map(c => c.suspicionScore))
  }));
}