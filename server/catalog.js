// Server-side copy of the default catalog + deposit rules (mirrors js/store.js).
// The server always prices the deposit itself; the browser's number is only a cross-check.
const DEFAULT_SERVICES = [
  { id: 'full', name: 'Full Groom', desc: 'Bath, blow-dry, breed-appropriate haircut, nails, ears and sanitary trim.', price: 95, minutes: 120, sizePricing: true, active: true, tag: 'Most booked' },
  { id: 'bath', name: 'Bath & Tidy', desc: 'Hydrating bath, blow-dry, brush-out, nails, ears and a face, feet & fanny tidy.', price: 70, minutes: 90, sizePricing: true, active: true },
  { id: 'deshed', name: 'De-shedding Treatment', desc: 'Undercoat treatment, high-velocity dry and thorough brush-out. Cuts shedding for weeks.', price: 85, minutes: 105, sizePricing: true, active: true },
  { id: 'puppy', name: 'Puppy Intro Groom', desc: 'A gentle, short first visit for pups under 6 months: bath, light trim, nails.', price: 60, minutes: 60, sizePricing: false, active: true },
  { id: 'nails', name: 'Nail Trim & Grind', desc: 'Clip and smooth grind, plus paw-pad trim. A quick in-van visit.', price: 25, minutes: 20, sizePricing: false, active: true }
];
const DEFAULT_ADDONS = [
  { id: 'teeth', name: 'Teeth brushing', price: 12 },
  { id: 'facial', name: 'Blueberry facial', price: 10 },
  { id: 'balm', name: 'Paw & nose balm', price: 8 },
  { id: 'demat', name: 'De-matting (per 15 min)', price: 15 }
];
const SIZES = ['small', 'medium', 'large', 'xl'];
const DEFAULT_SETTINGS = {
  sizeUpcharge: { small: 0, medium: 10, large: 20, xl: 35 },
  depositPercent: 30, depositMin: 20,
  travelBufferMin: 30, minNoticeHours: 16, bookingWindowDays: 21, cancelWindowHours: 48,
  hours: { 0: null, 1: [540, 1020], 2: [480, 1080], 3: [480, 1080], 4: [480, 1080], 5: [480, 960], 6: [540, 840] },
  serviceArea: 'Austin, Round Rock, Pflugerville & Cedar Park'
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const defaults = () => ({ services: clone(DEFAULT_SERVICES), addons: clone(DEFAULT_ADDONS), settings: clone(DEFAULT_SETTINGS) });

function calcDeposit(total, s) {
  const raw = total * s.depositPercent / 100;
  return Math.min(total, Math.max(s.depositMin, Math.round(raw / 5) * 5));
}
function priceFor(svc, size, s) { return svc.price + (svc.sizePricing ? (s.sizeUpcharge[size] || 0) : 0); }

function quote(cfg, { serviceId, size, addons }) {
  const svc = cfg.services.find(x => x.id === serviceId && x.active);
  if (!svc || !SIZES.includes(size)) return null;
  const ads = cfg.addons.filter(a => (addons || []).includes(a.id));
  const total = priceFor(svc, size, cfg.settings) + ads.reduce((a, b) => a + b.price, 0);
  const deposit = calcDeposit(total, cfg.settings);
  return { svc, addons: ads, total, deposit, balance: total - deposit, minutes: svc.minutes };
}

// Light validation for config sent from the dashboard.
function sanitizeConfig(c) {
  const d = defaults();
  if (!c || !Array.isArray(c.services) || !Array.isArray(c.addons) || !c.settings) return null;
  const num = (v, min, max) => Number.isFinite(+v) && +v >= min && (max == null || +v <= max);
  const services = c.services.filter(s => s && typeof s.id === 'string' && num(s.price, 1, 10000) && num(s.minutes, 10, 600))
    .map(s => ({ id: s.id, name: String(s.name || '').slice(0, 80), desc: String(s.desc || '').slice(0, 300), price: Math.round(+s.price), minutes: Math.round(+s.minutes), sizePricing: !!s.sizePricing, active: !!s.active, ...(s.tag ? { tag: String(s.tag).slice(0, 30) } : {}) }));
  const addons = c.addons.filter(a => a && typeof a.id === 'string' && num(a.price, 0, 1000)).map(a => ({ id: a.id, name: String(a.name || '').slice(0, 80), price: Math.round(+a.price) }));
  const s = c.settings, settings = { ...d.settings };
  for (const k of ['depositMin', 'travelBufferMin', 'minNoticeHours', 'bookingWindowDays', 'cancelWindowHours']) if (num(s[k], 0, 10000)) settings[k] = Math.round(+s[k]);
  if (num(s.depositPercent, 0, 100)) settings.depositPercent = Math.round(+s.depositPercent);
  if (s.sizeUpcharge) for (const z of SIZES) if (num(s.sizeUpcharge[z], 0, 1000)) settings.sizeUpcharge[z] = Math.round(+s.sizeUpcharge[z]);
  if (s.hours && typeof s.hours === 'object') settings.hours = s.hours;
  if (typeof s.serviceArea === 'string') settings.serviceArea = s.serviceArea.slice(0, 120);
  if (!services.some(x => x.active)) return null;
  return { services, addons, settings };
}

module.exports = { defaults, quote, calcDeposit, sanitizeConfig, SIZES };
