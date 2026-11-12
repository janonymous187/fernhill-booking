/* Data layer: services, settings, bookings. Persisted in localStorage (demo). */
(function () {
  const KEY = 'fernhill-demo-v1';

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
  const SIZES = [
    { id: 'small', name: 'Small', range: 'Up to 25 lb' },
    { id: 'medium', name: 'Medium', range: '26–50 lb' },
    { id: 'large', name: 'Large', range: '51–90 lb' },
    { id: 'xl', name: 'Extra large', range: '90 lb +' }
  ];
  const DEFAULT_SETTINGS = {
    sizeUpcharge: { small: 0, medium: 10, large: 20, xl: 35 },
    depositPercent: 30, depositMin: 20,
    travelBufferMin: 30, minNoticeHours: 16, bookingWindowDays: 21, cancelWindowHours: 48,
    // minutes from midnight, [open, close]; null = closed. 0 = Sunday
    hours: { 0: null, 1: [540, 1020], 2: [480, 1080], 3: [480, 1080], 4: [480, 1080], 5: [480, 960], 6: [540, 840] },
    serviceArea: 'Austin, Round Rock, Pflugerville & Cedar Park'
  };

  const dayStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const at = (d, mins) => { const x = dayStart(d); x.setMinutes(mins); return x; };
  const makeRef = () => 'FH-' + Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[01OIL]/g, 'X') + Math.floor(Math.random() * 10);

  function calcDeposit(total, s) {
    const raw = total * s.depositPercent / 100;
    return Math.max(s.depositMin, Math.round(raw / 5) * 5);
  }
  function priceFor(svc, size, s) { return svc.price + (svc.sizePricing ? (s.sizeUpcharge[size] || 0) : 0); }

  function seedBookings(services, s) {
    const today = dayStart(new Date());
    const people = [
      ['Maya Thompson', 'Biscuit', 'Goldendoodle', 'large', 'full', ['teeth'], 'Mats behind ears, gets nervous with the dryer.', '2107 Barton Hills Dr', '78704', 'Park in driveway; outlet by garage.'],
      ['Daniel Ortiz', 'Pepper', 'Miniature Schnauzer', 'small', 'full', [], 'Schnauzer cut, keep beard long.', '4512 Avenue F', '78751', ''],
      ['Priya Raman', 'Koda', 'Siberian Husky', 'large', 'deshed', ['balm'], 'Blowing coat. Friendly.', '9804 Copper Creek Dr', '78729', 'Gate code 4471.'],
      ['Chris Bennett', 'Lulu', 'Shih Tzu', 'small', 'bath', ['facial'], 'Tear staining — gentle around eyes.', '1300 W Koenig Ln', '78756', 'Apartment lot, space 14.'],
      ['Alyssa Greene', 'Murphy', 'Labrador Retriever', 'large', 'bath', [], '', '6201 Shoal Creek Blvd', '78757', ''],
      ['Jordan Lee', 'Olive', 'Cavalier King Charles', 'small', 'nails', [], 'Hates back paws being touched.', '815 E 49th St', '78751', 'Street parking is fine.'],
      ['Sam Whitaker', 'Gus', 'Bernese Mountain Dog', 'xl', 'deshed', ['teeth'], 'Older boy, stiff hips — lift ramp please.', '3409 Hillview Rd', '78703', ''],
      ['Hannah Cole', 'Ziggy', 'Mini Poodle', 'small', 'puppy', [], 'First groom ever, 4 months old.', '12010 Jollyville Rd', '78759', '']
    ];
    // [dayOffset, startMinutes]
    const plan = [[-6, 600], [-2, 540], [1, 540], [1, 750], [2, 480], [3, 660], [5, 600], [8, 570]];
    const statuses = ['completed', 'completed'];
    const addonsById = Object.fromEntries(DEFAULT_ADDONS.map(a => [a.id, a]));
    const out = [];
    plan.forEach(([off, mins], i) => {
      let d = addDays(today, off);
      const dow = d.getDay();
      if (!s.hours[dow]) d = addDays(d, 1);
      const p = people[i];
      const svc = services.find(x => x.id === p[4]);
      const addons = p[5].map(id => addonsById[id]);
      const total = priceFor(svc, p[3], s) + addons.reduce((a, b) => a + b.price, 0);
      const deposit = calcDeposit(total, s);
      const start = at(d, mins);
      const created = addDays(start, -5 - (i % 4));
      out.push({
        id: 'b' + (i + 1), ref: makeRef(), createdAt: created.toISOString(), seen: true, source: 'online',
        serviceId: svc.id, serviceName: svc.name, size: p[3], addons, minutes: svc.minutes,
        start: start.toISOString(), total, deposit, balance: total - deposit,
        dog: { name: p[1], breed: p[2], age: '', notes: p[6] },
        customer: { name: p[0], phone: '(512) 555-01' + String(20 + i * 7).padStart(2, '0'), email: p[0].split(' ')[0].toLowerCase() + '@example.com' },
        address: { street: p[7], unit: '', city: 'Austin', zip: p[8], access: p[9] },
        payment: { id: 'pi_demo_seed' + i, status: 'succeeded', method: 'Test card •••• 4242', provider: 'demo', paidAt: created.toISOString() },
        status: statuses[i] || 'confirmed'
      });
    });
    return out;
  }

  function fresh() {
    const services = JSON.parse(JSON.stringify(DEFAULT_SERVICES));
    const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    return { version: 1, services, addons: JSON.parse(JSON.stringify(DEFAULT_ADDONS)), settings, bookings: seedBookings(services, settings) };
  }

  let mem = null;
  function load() {
    if (mem) return mem;
    try { const raw = localStorage.getItem(KEY); if (raw) { mem = JSON.parse(raw); if (mem && mem.version === 1) return mem; } } catch (e) { }
    mem = fresh(); save(); return mem;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* storage unavailable: keep in memory */ } }

  function slotsFor(date, minutes, excludeId) {
    const db = load(), s = db.settings;
    const hrs = s.hours[new Date(date).getDay()];
    if (!hrs) return [];
    const earliest = Date.now() + s.minNoticeHours * 3600e3;
    const buf = s.travelBufferMin;
    const items = remoteBusy ? remoteBusy : db.bookings.filter(b => b.status !== 'cancelled');
    const dayBk = items.filter(b => (!excludeId || b.id !== excludeId) && dayStart(b.start).getTime() === dayStart(date).getTime())
      .map(b => { const st = new Date(b.start).getTime(); return [st, st + ((b.minutes || 0) + buf) * 60e3]; });
    const out = [];
    for (let m = hrs[0]; m + minutes <= hrs[1]; m += 30) {
      const st = at(date, m).getTime();
      if (st < earliest) continue;
      const en = st + (minutes + buf) * 60e3;
      if (dayBk.some(([a, b]) => st < b && a < en)) continue;
      out.push(new Date(st));
    }
    return out;
  }

  /* ---- Server sync: prices/rules are public. Bookings load only after sign-in. ---- */
  const API = (location.protocol === 'http:' || location.protocol === 'https:') ? '' : null;
  let pushT = null, payments = { provider: 'demo', mode: 'demo', configured: false };
  let remoteBusy = null;
  const stripePaid = (b) => b && b.payment && (b.payment.provider === 'stripe' || b.payment.provider === 'stripe-test');
  function saveLocal() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* storage unavailable */ } }
  function sendConfig() {
    const { services, addons, settings } = load();
    return fetch(API + '/api/config', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ services, addons, settings }) }).catch(() => { });
  }
  function pushConfig(now) {
    if (API === null) return Promise.resolve();
    clearTimeout(pushT);
    if (now) return sendConfig();
    pushT = setTimeout(sendConfig, 250);
    return Promise.resolve();
  }
  function mergeServerBooking(b) {
    const db = load(); const i = db.bookings.findIndex(x => x.id === b.id || (b.ref && x.ref === b.ref));
    if (i >= 0) db.bookings[i] = { ...db.bookings[i], ...b, seen: db.bookings[i].seen || b.seen }; else db.bookings.push(b);
  }
  function applyPublic(st) {
    const db = load();
    if (st.config) { db.services = st.config.services; db.addons = st.config.addons; db.settings = st.config.settings; }
    if (st.payments) payments = st.payments;
    remoteBusy = Array.isArray(st.busy) ? st.busy : [];
    const keepId = (location.hash || '').startsWith('#/confirmed/') ? decodeURIComponent((location.hash || '').split('/')[2] || '') : '';
    db.bookings = db.bookings.filter(b => b.id === keepId || !stripePaid(b));
    saveLocal();
  }
  async function sync() {
    if (API === null) return;
    try {
      const r = await fetch(API + '/api/catalog', { cache: 'no-store', credentials: 'same-origin' });
      if (!r.ok) { remoteBusy = []; return; }
      applyPublic(await r.json());
    } catch (e) { remoteBusy = []; }
  }
  async function syncDashboard() {
    if (API === null) return;
    const r = await fetch(API + '/api/state', { cache: 'no-store', credentials: 'same-origin' });
    if (r.status === 401 || r.status === 403) { const err = new Error('signin'); err.status = r.status; throw err; }
    if (!r.ok) throw new Error('Could not load bookings');
    const st = await r.json();
    const db = load();
    if (st.config) { db.services = st.config.services; db.addons = st.config.addons; db.settings = st.config.settings; }
    db.bookings = Array.isArray(st.bookings) ? st.bookings : [];
    if (st.payments) payments = st.payments;
    remoteBusy = db.bookings.filter(b => b.status !== 'cancelled').map(b => ({ start: b.start, minutes: b.minutes }));
    saveLocal();
  }
  function forgetSensitive() {
    if (API === null || !mem) return;
    mem.bookings = mem.bookings.filter(b => !stripePaid(b));
    remoteBusy = [];
    saveLocal();
  }

  window.Store = {
    SIZES,
    get db() { return load(); },
    save() { save(); pushConfig(); },
    async reset() { mem = fresh(); save(); await pushConfig(true); return sync(); },
    sync, syncDashboard, forgetSensitive, mergeServerBooking,
    get payments() { return payments; },
    get online() { return API !== null; },
    priceFor: (svc, size) => priceFor(svc, size, load().settings),
    calcDeposit: (total) => calcDeposit(total, load().settings),
    slotsFor,
    dayStart, addDays, makeRef,
    addBooking(b) { load().bookings.push(b); save(); },
    updateBooking(id, patch) {
      const b = load().bookings.find(x => x.id === id);
      if (b) {
        Object.assign(b, patch); save();
        if (API !== null && b.payment && (b.payment.provider === 'stripe-test' || b.payment.provider === 'stripe') && (patch.seen !== undefined || patch.status)) {
          fetch(API + '/api/bookings/' + encodeURIComponent(id), { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seen: patch.seen, status: patch.status }) }).catch(() => { });
        }
      }
      return b;
    }
  };
})();
