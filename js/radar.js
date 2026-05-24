// Radar scope — reads lastFlights, REGIONS, getAltitudeColour from app.js

const SWEEP_DEG_S  = 45;   // 45°/s = 8 s per revolution
const BLIP_DECAY   = 0.14; // brightness/s (fades to ~0 in 7 s)
const TRAIL_DEG    = 70;
const TRAIL_STEPS  = 22;

let radarOpen      = false;
let radarAnimId    = null;
let radarLastTime  = 0;
let sweepAngle     = 0;    // 0 = North, clockwise
let radarTargets   = [];
let radarRangeKm   = 500;
let userLocation     = null; // { lat, lng } when geolocation is active
let userLocationName = null; // reverse-geocoded place name

// ── Helpers ───────────────────────────────────────────────────

function latLngToRadar(lat, lng, cLat, cLng, rangeKm, R) {
  const kpLat = 110.574;
  const kpLng = 111.32 * Math.cos(cLat * Math.PI / 180);
  const x =  (lng - cLng) * kpLng * (R / rangeKm);
  const y = -(lat - cLat) * kpLat  * (R / rangeKm);
  return (x * x + y * y) <= R * R ? { x, y } : null;
}

function blipAngleDeg(x, y) {
  return (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;
}

function sweepPassed(prev, curr, target) {
  return curr >= prev ? (target >= prev && target < curr)
                      : (target >= prev || target < curr);
}

// ── Targets ───────────────────────────────────────────────────

function getRadarCenter() {
  if (userLocation) return [userLocation.lat, userLocation.lng];
  const region = document.getElementById('filter-region').value;
  return REGIONS[region]?.view.center || [-41.5, 172.8];
}

function buildRadarTargets() {
  const canvas = document.getElementById('radar-canvas');
  const R = canvas.width / 2 - 14;
  const [cLat, cLng] = getRadarCenter();

  radarTargets = lastFlights.map(f => {
    const pos = latLngToRadar(f.lat, f.lng, cLat, cLng, radarRangeKm, R);
    if (!pos) return null;
    return {
      x: pos.x, y: pos.y,
      brightness: 0,
      callsign: f.callsign,
      colour: getAltitudeColour(f.altitude, f.isGround),
      angle: blipAngleDeg(pos.x, pos.y),
    };
  }).filter(Boolean);

  const el = document.getElementById('radar-count');
  if (el) el.textContent = `${radarTargets.length} targets`;
}

// ── Open / close ──────────────────────────────────────────────

function openRadar() {
  document.getElementById('radar-overlay').classList.add('radar-visible');
  radarOpen = true;
  sizeRadarCanvas();
  updateRegionLabel();
  buildRadarTargets();
  sweepAngle    = 0;
  radarLastTime = performance.now();
  radarAnimId   = requestAnimationFrame(radarFrame);
}

function closeRadar() {
  radarOpen = false;
  document.getElementById('radar-overlay').classList.remove('radar-visible');
  if (radarAnimId) { cancelAnimationFrame(radarAnimId); radarAnimId = null; }
}

function sizeRadarCanvas() {
  const canvas = document.getElementById('radar-canvas');
  const size = Math.floor(Math.min(window.innerWidth * 0.85, window.innerHeight * 0.72, 680));
  canvas.width  = size;
  canvas.height = size;
}

function updateRegionLabel() {
  const names = { nz:'NEW ZEALAND', au:'AUSTRALIA', uk:'UK / IRELAND', eu:'EUROPE', us:'UNITED STATES', world:'WORLD' };
  const el = document.getElementById('radar-region-name');
  if (!el) return;
  if (userLocation) {
    const coords = `${userLocation.lat.toFixed(4)}°, ${userLocation.lng.toFixed(4)}°`;
    el.textContent = userLocationName ? `${userLocationName}  —  ${coords}` : coords;
  } else {
    userLocationName = null;
    el.textContent = names[document.getElementById('filter-region').value] || '';
  }
}

async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
    const res  = await fetch(url);
    const data = await res.json();
    const a    = data.address || {};
    const parts = [
      a.suburb || a.village || a.hamlet || a.neighbourhood,
      a.city   || a.town   || a.municipality || a.county,
      a.country_code?.toUpperCase(),
    ].filter(Boolean);
    userLocationName = parts.length ? parts.join(', ') : data.display_name?.split(',')[0];
    updateRegionLabel();
  } catch {
    // silent — coordinates still show
  }
}

function locateUser() {
  const btn = document.getElementById('radar-locate-btn');

  // Toggle off if already active
  if (userLocation) {
    userLocation = null;
    if (btn) { btn.textContent = '⊕ MY POS'; btn.classList.remove('active'); }
    updateRegionLabel();
    buildRadarTargets();
    return;
  }

  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser.');
    return;
  }

  if (btn) btn.textContent = '⊕ LOCATING…';

  navigator.geolocation.getCurrentPosition(
    pos => {
      userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (btn) { btn.textContent = '⊕ MY POS'; btn.classList.add('active'); }
      updateRegionLabel();       // shows coords immediately
      reverseGeocode(userLocation.lat, userLocation.lng); // fills in place name async
      buildRadarTargets();
    },
    err => {
      if (btn) btn.textContent = '⊕ MY POS';
      const msg = err.code === 1 ? 'Location access denied — allow it in browser settings.'
                : err.code === 2 ? 'Position unavailable.'
                : 'Location request timed out.';
      alert(msg);
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ── Animation loop ────────────────────────────────────────────

function radarFrame(timestamp) {
  if (!radarOpen) return;

  const dt = Math.min((timestamp - radarLastTime) / 1000, 0.1);
  radarLastTime = timestamp;
  const prev = sweepAngle;
  sweepAngle = (sweepAngle + SWEEP_DEG_S * dt) % 360;

  for (const t of radarTargets) {
    t.brightness = Math.max(0, t.brightness - BLIP_DECAY * dt);
    if (sweepPassed(prev, sweepAngle, t.angle)) t.brightness = 1.0;
  }

  drawRadar();
  radarAnimId = requestAnimationFrame(radarFrame);
}

// ── Draw ──────────────────────────────────────────────────────

function drawRadar() {
  const canvas = document.getElementById('radar-canvas');
  const ctx    = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2;
  const R  = Math.min(cx, cy) - 2;

  // ── Clip to circle ──
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();

  // Background
  ctx.fillStyle = '#010801';
  ctx.fillRect(0, 0, W, H);

  // Range rings + km labels
  for (let i = 1; i <= 4; i++) {
    const rr = R * i / 4;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,255,65,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,255,65,0.28)';
    ctx.font = "9px 'Courier New',monospace";
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(radarRangeKm * i / 4) + 'km', cx, cy - rr + 11);
  }

  // Crosshair
  ctx.strokeStyle = 'rgba(0,255,65,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
  ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
  ctx.stroke();

  // Sweep trail — wedge slices, bright near arm, fading back
  for (let i = 0; i < TRAIL_STEPS; i++) {
    const t  = i / TRAIL_STEPS;
    const a1 = (sweepAngle - 90 - t * TRAIL_DEG) * Math.PI / 180;
    const a2 = (sweepAngle - 90 - (t + 1 / TRAIL_STEPS) * TRAIL_DEG) * Math.PI / 180;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R - 1, a2, a1, false);
    ctx.closePath();
    ctx.fillStyle = `rgba(0,255,65,${(1 - t) * 0.18})`;
    ctx.fill();
  }

  // Sweep arm with gradient
  const sRad = (sweepAngle - 90) * Math.PI / 180;
  const tipX = cx + Math.cos(sRad) * R;
  const tipY = cy + Math.sin(sRad) * R;
  const armG = ctx.createLinearGradient(cx, cy, tipX, tipY);
  armG.addColorStop(0,   'rgba(0,255,65,0.05)');
  armG.addColorStop(0.4, 'rgba(0,255,65,0.4)');
  armG.addColorStop(1,   'rgba(0,255,65,1)');
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(tipX, tipY);
  ctx.strokeStyle = armG;
  ctx.lineWidth = 2;
  ctx.shadowBlur = 10;
  ctx.shadowColor = '#00ff41';
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Centre pip / you-are-here indicator
  if (userLocation) {
    // Pulsing ring in cyan to mark the operator's position
    const pulse = (Math.sin(performance.now() * 0.003) + 1) / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 8 + pulse * 5, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(80, 210, 255, ${0.25 + pulse * 0.5})`;
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 8 * pulse;
    ctx.shadowColor = 'rgba(80, 210, 255, 0.8)';
    ctx.stroke();
    ctx.shadowBlur = 0;
    // Crosshair
    ctx.strokeStyle = 'rgba(80, 210, 255, 0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 7, cy); ctx.lineTo(cx + 7, cy);
    ctx.moveTo(cx, cy - 7); ctx.lineTo(cx, cy + 7);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#00ff41';
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#00ff41';
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Blips
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const t of radarTargets) {
    if (t.brightness < 0.02) continue;
    const bx = cx + t.x, by = cy + t.y;
    const b  = t.brightness;
    const dr = 2.5 + b * 2.5;
    ctx.globalAlpha = b;
    ctx.beginPath();
    ctx.arc(bx, by, dr, 0, Math.PI * 2);
    ctx.fillStyle = t.colour;
    ctx.shadowBlur = 14 * b;
    ctx.shadowColor = t.colour;
    ctx.fill();
    ctx.shadowBlur = 0;
    if (b > 0.6 && W > 350) {
      ctx.font = `${Math.round(9 + b * 2)}px 'Courier New',monospace`;
      ctx.fillStyle = t.colour;
      ctx.fillText(t.callsign, bx + dr + 3, by);
    }
    ctx.globalAlpha = 1;
  }

  ctx.restore(); // end clip

  // Outer border ring
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = '#00ff41';
  ctx.lineWidth = 2.5;
  ctx.shadowBlur = 18;
  ctx.shadowColor = '#00ff41';
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Compass points (inside, near edge)
  ctx.font = "bold 11px 'Courier New',monospace";
  ctx.fillStyle = 'rgba(0,255,65,0.5)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [lbl, deg] of [['N',0],['E',90],['S',180],['W',270]]) {
    const r = (deg - 90) * Math.PI / 180;
    ctx.fillText(lbl, cx + Math.cos(r) * (R - 14), cy + Math.sin(r) * (R - 14));
  }
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
}

// ── Range ─────────────────────────────────────────────────────

function setRadarRange(km) {
  radarRangeKm = km;
  document.querySelectorAll('.range-btn').forEach(b =>
    b.classList.toggle('active', +b.dataset.range === km));
  if (radarOpen) buildRadarTargets();
}

// ── Init ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('radar-open-btn').addEventListener('click', openRadar);
  document.getElementById('radar-close-btn').addEventListener('click', closeRadar);
  document.getElementById('radar-locate-btn').addEventListener('click', locateUser);
  document.getElementById('radar-overlay').addEventListener('click', e => {
    if (e.target.id === 'radar-overlay') closeRadar();
  });
  document.querySelectorAll('.range-btn').forEach(b =>
    b.addEventListener('click', () => setRadarRange(+b.dataset.range)));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && radarOpen) closeRadar();
  });
});
