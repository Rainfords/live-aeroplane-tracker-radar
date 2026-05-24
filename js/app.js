const API_BASE = '/api/opensky';
const AUTO_INTERVAL = 30; // seconds between auto-refreshes
const TRAIL_MAX = 8;      // max position history points per aircraft

const REGIONS = {
  nz:    { bbox: { lamin: -48, lamax: -33, lomin: 165, lomax: 180 }, view: { center: [-41.5, 172.8], zoom: 5 } },
  au:    { bbox: { lamin: -44, lamax: -10, lomin: 113, lomax: 154 }, view: { center: [-25.0, 133.0], zoom: 4 } },
  uk:    { bbox: { lamin: 49,  lamax: 61,  lomin: -11, lomax: 3   }, view: { center: [54.0, -2.0],   zoom: 6 } },
  eu:    { bbox: { lamin: 35,  lamax: 72,  lomin: -12, lomax: 45  }, view: { center: [50.0, 10.0],   zoom: 4 } },
  us:    { bbox: { lamin: 24,  lamax: 50,  lomin: -126, lomax: -65 }, view: { center: [39.0, -98.0],  zoom: 4 } },
  world: { bbox: null, view: { center: [20.0, 0.0], zoom: 2 } },
};

// OpenSky state vector field indices
const F = {
  ICAO24: 0, CALLSIGN: 1, COUNTRY: 2,
  LON: 5, LAT: 6, BARO_ALT: 7, ON_GROUND: 8,
  VELOCITY: 9, TRUE_TRACK: 10, VERT_RATE: 11,
};

let map;
let markersLayer;
let lastFlights = [];
let trailLayer;
let currentMarkers = {};
let trailHistory  = {};   // { icao24: [[lat, lng], ...] }
let trailPolylines = {};  // { icao24: L.Polyline }
let isFetching = false;
let autoTimer = null;
let countdownTimer = null;
let autoCountdown = AUTO_INTERVAL;

// ── Map ───────────────────────────────────────────────────────

function initMap() {
  map = L.map('map', { zoomControl: true }).setView(
    REGIONS.nz.view.center,
    REGIONS.nz.view.zoom
  );

  const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors | Flights: OpenSky Network',
    maxZoom: 18,
  }).addTo(map);

  tiles.on('load', () => {
    const el = document.querySelector('.leaflet-tile-pane');
    if (el) el.style.filter = 'invert(1) hue-rotate(180deg) saturate(0.4) brightness(0.65)';
  });

  // Trail layer renders below aircraft markers
  trailLayer   = L.layerGroup().addTo(map);
  markersLayer = L.layerGroup().addTo(map);
}

// ── Altitude colour ───────────────────────────────────────────

function getAltitudeColour(altitude, isGround) {
  if (isGround)          return '#ff9900'; // amber  — on ground
  if (altitude == null)  return '#408040'; // dim    — no data
  if (altitude <  1000)  return '#ff4444'; // red    — very low
  if (altitude < 10000)  return '#ff8800'; // orange — low / approach
  if (altitude < 20000)  return '#ffcc00'; // yellow — mid
  if (altitude < 30000)  return '#aaff44'; // lime   — upper mid
  return '#00ff41';                         // green  — cruise
}

// ── API ───────────────────────────────────────────────────────

function buildApiUrl() {
  const region = document.getElementById('filter-region').value;
  const bbox = REGIONS[region]?.bbox;
  if (!bbox) return API_BASE;
  const { lamin, lamax, lomin, lomax } = bbox;
  return `${API_BASE}?lamin=${lamin}&lamax=${lamax}&lomin=${lomin}&lomax=${lomax}`;
}

function parseFlights(apiResponse) {
  const states = apiResponse?.states;
  if (!Array.isArray(states)) return [];
  return states
    .filter(s => s[F.LAT] != null && s[F.LON] != null)
    .map(s => ({
      id:       s[F.ICAO24],
      callsign: (s[F.CALLSIGN] || '').trim() || s[F.ICAO24],
      country:  s[F.COUNTRY] || '',
      lat:      s[F.LAT],
      lng:      s[F.LON],
      altitude: s[F.BARO_ALT]   != null ? Math.round(s[F.BARO_ALT] * 3.281) : null,
      speed:    s[F.VELOCITY]   != null ? Math.round(s[F.VELOCITY]  * 3.6)   : null,
      direction: s[F.TRUE_TRACK] ?? null,
      isGround: s[F.ON_GROUND]  || false,
      vertRate: s[F.VERT_RATE]  ?? null,
    }));
}

// ── Icons & popups ────────────────────────────────────────────

function createAircraftIcon(direction, colour) {
  const deg = direction ?? 0;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"
    style="transform:rotate(${deg}deg);filter:drop-shadow(0 0 3px ${colour})">
    <polygon points="12,2 17,18 12,14 7,18" fill="${colour}"/>
  </svg>`;
  return L.divIcon({ html: svg, className: 'aircraft-icon', iconSize: [24, 24], iconAnchor: [12, 12] });
}

function buildPopupContent(f, colour) {
  const alt   = f.altitude != null ? `${f.altitude.toLocaleString()} ft` : 'N/A';
  const speed = f.speed    != null ? `${f.speed} km/h` : 'N/A';
  const hdg   = f.direction != null ? `${Math.round(f.direction)}°` : 'N/A';
  const vert  = f.vertRate  != null
    ? (f.vertRate >  0.5 ? `&#8679; ${Math.round(f.vertRate)} m/s`
     : f.vertRate < -0.5 ? `&#8681; ${Math.abs(Math.round(f.vertRate))} m/s`
     : 'Level')
    : 'N/A';
  const stateLabel = f.isGround
    ? `<span style="color:var(--color-amber)">On Ground</span>`
    : `<span style="color:${colour}">Airborne</span>`;

  return `<div class="flight-popup">
    <div class="popup-callsign" style="color:${colour};text-shadow:0 0 6px ${colour}">${f.callsign}</div>
    <div class="popup-airline">${f.country}</div>
    <hr class="popup-divider">
    <div class="popup-detail"><span>Alt</span><span style="color:${colour}">${alt}</span></div>
    <div class="popup-detail"><span>Speed</span><span>${speed}</span></div>
    <div class="popup-detail"><span>Heading</span><span>${hdg}</span></div>
    <div class="popup-detail"><span>V/S</span><span>${vert}</span></div>
    <div class="popup-detail"><span>State</span><span>${stateLabel}</span></div>
    <div class="popup-detail"><span>ICAO24</span><span style="font-size:10px;opacity:0.6">${f.id}</span></div>
  </div>`;
}

// ── Trails ────────────────────────────────────────────────────

function updateTrails(flights) {
  const currentIds = new Set(flights.map(f => f.id));

  // Remove polylines for aircraft no longer in view
  for (const id of Object.keys(trailPolylines)) {
    if (!currentIds.has(id)) {
      trailLayer.removeLayer(trailPolylines[id]);
      delete trailPolylines[id];
    }
  }

  for (const flight of flights) {
    const { id, lat, lng, altitude, isGround } = flight;
    const colour = getAltitudeColour(altitude, isGround);

    if (!trailHistory[id]) trailHistory[id] = [];
    const hist = trailHistory[id];

    const last = hist[hist.length - 1];
    if (!last || last[0] !== lat || last[1] !== lng) {
      hist.push([lat, lng]);
      if (hist.length > TRAIL_MAX) hist.shift();
    }

    if (hist.length < 2) continue;

    if (trailPolylines[id]) {
      trailPolylines[id].setLatLngs(hist);
      trailPolylines[id].setStyle({ color: colour });
    } else {
      trailPolylines[id] = L.polyline(hist, { color: colour, weight: 1.5, opacity: 0.45 })
        .addTo(trailLayer);
    }
  }
}

function clearTrails() {
  trailLayer.clearLayers();
  trailHistory  = {};
  trailPolylines = {};
}

// ── Render ────────────────────────────────────────────────────

function renderMarkers(flights) {
  lastFlights = flights;
  if (typeof radarOpen !== 'undefined' && radarOpen) buildRadarTargets();

  markersLayer.clearLayers();
  currentMarkers = {};

  updateTrails(flights);

  for (const flight of flights) {
    const colour = getAltitudeColour(flight.altitude, flight.isGround);
    const icon   = createAircraftIcon(flight.direction, colour);
    const marker = L.marker([flight.lat, flight.lng], { icon, title: flight.callsign });
    marker.bindPopup(buildPopupContent(flight, colour), { className: 'radar-popup', maxWidth: 240 });
    marker.addTo(markersLayer);
    currentMarkers[flight.id] = marker;
  }

  const el = document.getElementById('status-flights');
  if (el) el.textContent = `Flights: ${flights.length}`;
  if (flights.length === 0) setStatus('No aircraft found in this region', 'warning');
}

// ── Status ────────────────────────────────────────────────────

let statusTimer = null;

function setStatus(message, type) {
  const el = document.getElementById('status-message');
  if (!el) return;
  el.textContent = message;
  el.className = type || '';
  if (statusTimer) clearTimeout(statusTimer);
  if (type !== 'error') {
    statusTimer = setTimeout(() => {
      if (el.textContent === message) { el.textContent = ''; el.className = ''; }
    }, 5000);
  }
}

// ── Fetch ─────────────────────────────────────────────────────

async function fetchFlights() {
  if (isFetching) return;
  isFetching = true;

  const fetchBtn = document.getElementById('fetch-btn');
  if (fetchBtn) fetchBtn.disabled = true;
  setStatus('Fetching…', '');

  try {
    const response = await fetch(buildApiUrl());
    if (!response.ok) throw new Error(`OpenSky ${response.status}: ${response.statusText}`);
    const data = await response.json();
    const flights = parseFlights(data);
    renderMarkers(flights);

    const timeEl = document.getElementById('status-time');
    if (timeEl) timeEl.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
    if (flights.length > 0) setStatus(`${flights.length} aircraft`, 'success');

  } catch (err) {
    setStatus(err.message || 'Fetch error', 'error');
  } finally {
    isFetching = false;
    if (fetchBtn) fetchBtn.disabled = false;
    if (autoTimer) { autoCountdown = AUTO_INTERVAL; updateCountdownDisplay(); }
  }
}

// ── Auto-refresh ──────────────────────────────────────────────

function updateCountdownDisplay() {
  const el = document.getElementById('status-countdown');
  if (el) el.textContent = `Next: ${autoCountdown}s`;
}

function startAutoRefresh() {
  stopAutoRefresh();
  fetchFlights();
  autoTimer = setInterval(fetchFlights, AUTO_INTERVAL * 1000);
  autoCountdown = AUTO_INTERVAL;
  countdownTimer = setInterval(() => {
    autoCountdown = Math.max(0, autoCountdown - 1);
    if (autoCountdown === 0) autoCountdown = AUTO_INTERVAL;
    updateCountdownDisplay();
  }, 1000);

  const btn = document.getElementById('auto-btn');
  if (btn) { btn.textContent = 'AUTO ■'; btn.classList.add('active'); }
  const cdEl = document.getElementById('status-countdown');
  if (cdEl) cdEl.style.display = '';
}

function stopAutoRefresh() {
  if (autoTimer && autoTimer !== 'paused') clearInterval(autoTimer);
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  autoTimer = null;

  const btn = document.getElementById('auto-btn');
  if (btn) { btn.textContent = 'AUTO ▶'; btn.classList.remove('active'); }
  const cdEl = document.getElementById('status-countdown');
  if (cdEl) cdEl.style.display = 'none';
}

function toggleAutoRefresh() {
  if (autoTimer) stopAutoRefresh();
  else startAutoRefresh();
}

// Pause auto when tab is hidden, resume when visible
document.addEventListener('visibilitychange', () => {
  if (document.hidden && autoTimer) {
    clearInterval(autoTimer);
    autoTimer = 'paused';
  } else if (!document.hidden && autoTimer === 'paused') {
    startAutoRefresh();
  }
});

// ── Region change ─────────────────────────────────────────────

function onRegionChange() {
  const region = document.getElementById('filter-region').value;
  const view = REGIONS[region]?.view;
  if (view) map.setView(view.center, view.zoom, { animate: true });
  clearTrails();
}

// ── Init ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  document.getElementById('fetch-btn').addEventListener('click', fetchFlights);
  document.getElementById('auto-btn').addEventListener('click', toggleAutoRefresh);
  document.getElementById('filter-region').addEventListener('change', onRegionChange);
});
