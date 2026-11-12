(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const app = $('#app'), topbar = $('#topbar');
  const BIZ = { name: 'Fernhill Mobile Grooming', city: 'Austin, TX', phone: '(512) 555-0148' };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const fmt = (d, o) => new Date(d).toLocaleString('en-US', o);
  const fTime = (d) => fmt(d, { hour: 'numeric', minute: '2-digit' });
  const fDayLong = (d) => fmt(d, { weekday: 'long', month: 'long', day: 'numeric' });
  const fDayShort = (d) => fmt(d, { weekday: 'short', month: 'short', day: 'numeric' });
  const dur = (m) => m < 60 ? m + ' min' : (Math.floor(m / 60) + ' hr' + (m % 60 ? ' ' + (m % 60) + ' min' : ''));
  const sameDay = (a, b) => Store.dayStart(a).getTime() === Store.dayStart(b).getTime();

  const I = {
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
    van: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 7h11v9H2zM13 10h4l4 3v3h-8z"/><circle cx="6" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/></svg>',
    leaf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14z"/><path d="M5 19l7-7"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    dog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 5L6 3 4 8l3 2M14 5l4-2 2 5-3 2"/><path d="M7 10c0 6 2 10 5 10s5-4 5-10c0-3-2-5-5-5s-5 2-5 5z"/><path d="M11 15h2"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>'
  };
  const LOGO = '<svg class="brand-mark" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="11" fill="#1f3d33"/><path d="M20 8.5c-6.2 5-8.4 10-8.4 14.2a8.4 8.4 0 0 0 16.8 0C28.4 18.5 26.2 13.5 20 8.5z" fill="#faf6ef"/><path d="M20 15v16M20 21l-3.2-3M20 25.5l3.6-3.4" stroke="#1f3d33" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>';

  const STRIPE = () => Store.online && Store.payments.provider === 'stripe';
  const TEST_BANNER = () => STRIPE() ? `<div class="testmode-banner" role="note"><b>Stripe TEST MODE</b> · No real money moves. Pay with test card 4242 4242 4242 4242, any future date, any CVC.</div>` : '';

  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200); }

  /* ---------------- Booking state ---------------- */
  const blankForm = () => ({ dogName: '', breed: '', age: '', dogNotes: '', name: '', phone: '', email: '', street: '', unit: '', city: 'Austin', zip: '', access: '' });
  let S = newState();
  function newState() { return { step: 0, size: '', serviceId: '', addons: [], date: null, time: null, form: blankForm(), agree: false, paying: false, errors: {} }; }
  const STEPS = ['Service', 'Date & time', 'Details', 'Deposit'];

  function quote() {
    const db = Store.db;
    const svc = db.services.find(s => s.id === S.serviceId && s.active);
    if (!svc) return null;
    const size = S.size || 'small';
    const base = Store.priceFor(svc, size);
    const addons = db.addons.filter(a => S.addons.includes(a.id));
    const total = base + addons.reduce((a, b) => a + b.price, 0);
    const deposit = Math.min(total, Store.calcDeposit(total));
    return { svc, base, addons, total, deposit, balance: total - deposit, minutes: svc.minutes };
  }

  function stepValid(step) {
    if (step === 0) return !!(S.size && quote());
    if (step === 1) return !!S.time;
    if (step === 2) return Object.keys(validateForm()).length === 0;
    return true;
  }

  function validateForm() {
    const f = S.form, e = {};
    if (!f.dogName.trim()) e.dogName = "Please add your dog's name.";
    if (!f.breed.trim()) e.breed = 'Please add a breed (or "mixed").';
    if (!f.name.trim()) e.name = 'Please add your name.';
    if (f.phone.replace(/\D/g, '').length < 10) e.phone = 'Enter a 10-digit phone number.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) e.email = 'Enter a valid email address.';
    if (!f.street.trim()) e.street = 'Please add the street address.';
    if (!f.city.trim()) e.city = 'Please add the city.';
    if (!/^\d{5}$/.test(f.zip.trim())) e.zip = 'Enter a 5-digit ZIP code.';
    return e;
  }

  /* ---------------- Top bar ---------------- */
  function renderTop(route) {
    const right = route === 'dash'
      ? '<a class="toplink" href="#/"><span class="hide-sm">View booking page</span><span class="show-sm">Booking page</span></a>'
      : '<a class="toplink" href="#/dashboard"><span class="hide-sm">Groomer dashboard</span><span class="show-sm">Dashboard</span></a>';
    topbar.innerHTML = `<a class="brand" href="#/">${LOGO}<span><span class="brand-name">Fernhill</span><span class="brand-sub" style="display:block">Mobile Grooming · ${BIZ.city}</span></span></a>${right}`;
  }

  /* ---------------- Booking page ---------------- */
  function renderBooking(opts = {}) {
    const focusKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fk : null;
    const daysEl = $('.days'); const daysScroll = daysEl ? daysEl.scrollLeft : 0;
    const q = quote();
    app.innerHTML = `${TEST_BANNER()}
      <div class="wrap">
        ${S.step === 0 ? `<section class="hero">
          <h1>A calm, full-service groom, right in your driveway.</h1>
          <p>One dog at a time in our climate-controlled van, so there are no cages and no waiting rooms. Pick a service and time, and we'll handle the rest.</p>
          <div class="trust"><span>${I.shield} Insured &amp; pet-first-aid certified</span><span>${I.van} Serving ${esc(Store.db.settings.serviceArea)}</span><span>${I.leaf} Gentle, hypoallergenic products</span></div>
        </section>` : ''}
        <ol class="stepper" aria-label="Booking progress">${STEPS.map((l, i) => `<li class="${i < S.step ? 'done' : i === S.step ? 'cur' : ''}" ${i === S.step ? 'aria-current="step"' : ''}><div class="bar"></div><span class="lbl">${i + 1}. ${l}</span></li>`).join('')}</ol>
        <div class="book-grid">
          <div id="stepArea">${[stepService, stepTime, stepDetails, stepDeposit][S.step]()}</div>
          <aside class="summary-col desk-only" aria-label="Booking summary">${summaryCard(q)}</aside>
        </div>
      </div>
      <p class="foot">${BIZ.name} · ${BIZ.city} · ${BIZ.phone}<br>${STRIPE() ? 'Deposits run through Stripe in TEST MODE. No real cards are charged and no money moves.' : 'Demo booking app built for Jeb. Deposits use a demo checkout; no real charges are made.'}</p>
      ${S.step < 3 ? mobileBar(q) : ''}`;
    const d2 = $('.days'); if (d2) d2.scrollLeft = daysScroll;
    if (opts.scrollTop) window.scrollTo({ top: 0 });
    if (focusKey) { const el = app.querySelector(`[data-fk="${CSS.escape(focusKey)}"]`); if (el) el.focus({ preventScroll: true }); }
  }

  function mobileBar(q) {
    const label = S.step === 2 ? 'Review deposit' : 'Continue';
    return `<div class="mbar">
      <div class="tot">${q ? `<b>${money(q.total)}</b><small>${money(q.deposit)} deposit today</small>` : `<b>Choose a service</b><small>Prices shown before you book</small>`}</div>
      <button class="btn btn-primary" data-act="next" ${stepValid(S.step) || S.step === 2 ? '' : 'disabled'}>${label}</button>
    </div>`;
  }

  function summaryCard(q) {
    const s = Store.db.settings;
    return `<div class="card summary">
      <h3>Your visit</h3>
      ${q ? `
        <div class="sum-meta">
          <div>${I.dog}<span>${esc(q.svc.name)}${S.size ? ' · ' + esc(Store.SIZES.find(z => z.id === S.size).name) + ' dog' : ''}</span></div>
          <div>${I.clock}<span>About ${dur(q.minutes)}</span></div>
          ${S.time ? `<div>${I.cal}<span>${fDayLong(S.time)}<br>Arrival ${fTime(S.time)}</span></div>` : ''}
          ${S.form.street && S.step >= 3 ? `<div>${I.pin}<span>${esc(S.form.street)}${S.form.unit ? ', ' + esc(S.form.unit) : ''}</span></div>` : ''}
        </div>
        <div class="sum-row"><span>${esc(q.svc.name)}</span><span>${money(q.base)}</span></div>
        ${q.addons.map(a => `<div class="sum-row"><span>${esc(a.name)}</span><span>${money(a.price)}</span></div>`).join('')}
        <div class="sum-row total"><span>Total</span><span>${money(q.total)}</span></div>
        <div class="sum-row dep"><span>Deposit due today</span><span>${money(q.deposit)}</span></div>
        <div class="sum-row"><span>Balance at appointment</span><span>${money(q.balance)}</span></div>
        <p class="muted" style="font-size:13px;margin:10px 0 0">The deposit holds your spot and comes off your total. Free cancellation up to ${s.cancelWindowHours} hours before.</p>
        ${S.step < 3 ? `<button class="btn btn-primary btn-block" style="margin-top:14px" data-act="next" ${stepValid(S.step) || S.step === 2 ? '' : 'disabled'}>${S.step === 2 ? 'Review deposit' : 'Continue'}</button>` : ''}
      ` : `<p class="muted" style="margin:0;font-size:14.5px">Choose your dog's size and a service to see your price and deposit.</p>`}
    </div>`;
  }

  function stepService() {
    const db = Store.db;
    const size = S.size || 'small';
    return `<div class="card">
      <h2>Choose a service</h2>
      <p class="lead">Prices include travel within our service area. Size affects the price for bath and groom services.</p>
      <div class="section-label" id="sizeLbl">Your dog's size</div>
      <div class="chips" role="group" aria-labelledby="sizeLbl">${Store.SIZES.map(z => `<button type="button" class="chip" data-act="size" data-id="${z.id}" data-fk="size-${z.id}" aria-pressed="${S.size === z.id}"><b>${z.name}</b><small>${z.range}</small></button>`).join('')}</div>
      <div class="section-label" id="svcLbl">Service</div>
      <div class="svc-list" role="radiogroup" aria-labelledby="svcLbl">${db.services.filter(s => s.active).map(s => `
        <button type="button" class="svc" role="radio" aria-checked="${S.serviceId === s.id}" data-act="svc" data-id="${s.id}" data-fk="svc-${s.id}">
          <span class="radio"></span>
          <span class="svc-main">
            <span class="svc-top"><span class="svc-name">${esc(s.name)}</span><span class="svc-price">${S.size || !s.sizePricing ? '' : 'from '}${money(Store.priceFor(s, size))}</span></span>
            <span class="svc-desc" style="display:block">${esc(s.desc)}</span>
            <span class="svc-meta"><span class="pill">${I.clock} ${dur(s.minutes)}</span>${s.tag ? `<span class="pill green">${esc(s.tag)}</span>` : ''}</span>
          </span>
        </button>`).join('')}</div>
      <div class="section-label">Add-ons <span style="text-transform:none;letter-spacing:0;font-weight:500">(optional)</span></div>
      <div class="addons">${db.addons.map(a => `<label class="addon"><input type="checkbox" data-act="addon" data-id="${a.id}" data-fk="addon-${a.id}" ${S.addons.includes(a.id) ? 'checked' : ''}><span class="n">${esc(a.name)}</span><span class="p">+${money(a.price)}</span></label>`).join('')}</div>
    </div>`;
  }

  function stepTime() {
    const q = quote(), s = Store.db.settings;
    const today = Store.dayStart(new Date());
    if (!S.date) {
      for (let i = 0; i <= s.bookingWindowDays; i++) { const d = Store.addDays(today, i); if (Store.slotsFor(d, q.minutes).length) { S.date = d.toISOString(); break; } }
    }
    const days = [];
    for (let i = 0; i <= s.bookingWindowDays; i++) { const d = Store.addDays(today, i); days.push({ d, n: Store.slotsFor(d, q.minutes).length }); }
    const slots = S.date ? Store.slotsFor(S.date, q.minutes) : [];
    const groups = [['Morning', slots.filter(t => t.getHours() < 12)], ['Afternoon', slots.filter(t => t.getHours() >= 12)]];
    return `<div class="card">
      ${backBtn()}
      <h2>Pick a day and arrival time</h2>
      <p class="lead">${esc(q.svc.name)} takes about ${dur(q.minutes)}. We'll text you when we're on the way.</p>
      <div class="section-label" id="dayLbl">${S.date ? fmt(S.date, { month: 'long', year: 'numeric' }) : 'Day'}</div>
      <div class="days" role="group" aria-labelledby="dayLbl">${days.map(({ d, n }) => `<button type="button" class="day" data-act="day" data-id="${d.toISOString()}" data-fk="day-${d.getTime()}" aria-pressed="${S.date && sameDay(S.date, d)}" ${n ? '' : 'disabled'} aria-label="${fDayLong(d)}${n ? ', ' + n + ' times open' : ', unavailable'}"><div class="dow">${fmt(d, { weekday: 'short' })}</div><div class="dnum">${d.getDate()}</div><div class="mon">${n ? n + ' open' : (s.hours[d.getDay()] ? 'Full' : 'Closed')}</div></button>`).join('')}</div>
      ${S.date ? `<div class="section-label" style="margin-top:14px">${fDayLong(S.date)}</div>` : ''}
      ${slots.length ? groups.filter(g => g[1].length).map(([lbl, arr]) => `<div class="slot-group">${lbl}</div><div class="slots">${arr.map(t => `<button type="button" class="slot" data-act="time" data-id="${t.toISOString()}" data-fk="t-${t.getTime()}" aria-pressed="${S.time === t.toISOString()}">${fTime(t)}</button>`).join('')}</div>`).join('')
        : `<div class="empty">No open times on this day. Try another date.</div>`}
      <div class="note">${I.info}<span>Times are arrival times (Central). Please have a parking spot within about 50 ft of an outdoor outlet — the van runs on its own power if there isn't one.</span></div>
    </div>`;
  }

  function field(id, label, opts = {}) {
    const e = S.errors[id];
    const type = opts.type || 'text';
    const common = `id="f-${id}" name="${id}" data-fk="f-${id}" data-field="${id}" ${opts.ac ? `autocomplete="${opts.ac}"` : ''} ${opts.im ? `inputmode="${opts.im}"` : ''} ${e ? 'aria-invalid="true"' : ''} aria-describedby="m-${id}${opts.hint ? ' h-' + id : ''}" ${opts.ph ? `placeholder="${esc(opts.ph)}"` : ''}`;
    const input = type === 'textarea' ? `<textarea ${common}>${esc(S.form[id])}</textarea>` : `<input type="${type}" ${common} value="${esc(S.form[id])}" ${opts.max ? `maxlength="${opts.max}"` : ''}>`;
    return `<div class="field ${e ? 'err' : ''} ${opts.cls || ''}"><label for="f-${id}">${label}${opts.optional ? ' <span class="opt">(optional)</span>' : ''}</label>${input}${opts.hint ? `<div class="hint" id="h-${id}">${opts.hint}</div>` : ''}<div class="msg" id="m-${id}">${esc(e || '')}</div></div>`;
  }

  function stepDetails() {
    const sz = Store.SIZES.find(z => z.id === S.size);
    return `<form class="card" id="detailsForm" novalidate>
      ${backBtn()}
      <h2>About your dog</h2>
      <p class="lead">Size: <b>${esc(sz.name)}</b> (${esc(sz.range)}). Anything you share helps us plan a calm visit.</p>
      <div class="fgrid two">
        ${field('dogName', "Dog's name", { ac: 'off', ph: 'e.g. Biscuit' })}
        ${field('breed', 'Breed', { ph: 'e.g. Goldendoodle', ac: 'off' })}
        ${field('age', 'Age', { optional: true, ph: 'e.g. 3 years', ac: 'off' })}
        ${field('dogNotes', 'Notes for your groomer', { type: 'textarea', optional: true, cls: 'span2', ph: 'Matting, sensitive spots, anxiety, allergies, preferred cut…' })}
      </div>
      <h2 style="margin-top:26px">Visit address</h2>
      <p class="lead">We park at your home and groom in the van.</p>
      <div class="fgrid two">
        ${field('street', 'Street address', { ac: 'address-line1', cls: 'span2', ph: '123 Main St' })}
        ${field('unit', 'Apt / unit', { optional: true, ac: 'address-line2' })}
        ${field('city', 'City', { ac: 'address-level2' })}
        ${field('zip', 'ZIP code', { ac: 'postal-code', im: 'numeric', max: 5 })}
        ${field('access', 'Parking & access notes', { optional: true, cls: 'span2', ph: 'Gate code, where to park, outlet location…' })}
      </div>
      <h2 style="margin-top:26px">Your contact info</h2>
      <p class="lead">We'll send your confirmation and an on-the-way text.</p>
      <div class="fgrid two">
        ${field('name', 'Your name', { ac: 'name', cls: 'span2' })}
        ${field('phone', 'Mobile phone', { type: 'tel', ac: 'tel', im: 'tel', ph: '(512) 555-0123' })}
        ${field('email', 'Email', { type: 'email', ac: 'email', ph: 'you@example.com' })}
      </div>
      <button type="submit" class="sr-only">Continue</button>
    </form>`;
  }

  function stepDeposit() {
    const q = quote(), f = S.form, s = Store.db.settings;
    const sz = Store.SIZES.find(z => z.id === S.size);
    const cutoff = new Date(new Date(S.time).getTime() - s.cancelWindowHours * 3600e3);
    return `<div class="card">
      ${backBtn()}
      <h2>Review &amp; pay deposit</h2>
      <p class="lead">Check the details, then pay a ${money(q.deposit)} deposit to lock in your time.</p>
      <div class="review-list">
        <div class="rv"><div><div class="k">Service</div><div class="v">${esc(q.svc.name)} · ${esc(sz.name)} dog${q.addons.length ? '<br><span class="muted">+ ' + q.addons.map(a => esc(a.name)).join(', ') + '</span>' : ''}</div></div><button class="edit" data-act="goto" data-id="0">Edit</button></div>
        <div class="rv"><div><div class="k">When</div><div class="v">${fDayLong(S.time)} · arrival ${fTime(S.time)}</div></div><button class="edit" data-act="goto" data-id="1">Edit</button></div>
        <div class="rv"><div><div class="k">Dog</div><div class="v">${esc(f.dogName)} · ${esc(f.breed)}${f.age ? ' · ' + esc(f.age) : ''}</div></div><button class="edit" data-act="goto" data-id="2">Edit</button></div>
        <div class="rv"><div><div class="k">Address</div><div class="v">${esc(f.street)}${f.unit ? ', ' + esc(f.unit) : ''}, ${esc(f.city)} ${esc(f.zip)}</div></div><button class="edit" data-act="goto" data-id="2">Edit</button></div>
        <div class="rv"><div><div class="k">Contact</div><div class="v">${esc(f.name)} · ${esc(f.phone)}<br><span class="muted">${esc(f.email)}</span></div></div><button class="edit" data-act="goto" data-id="2">Edit</button></div>
      </div>
      <div class="desk-hide" style="margin-top:8px">
        <div class="sum-row total"><span>Total</span><span>${money(q.total)}</span></div>
        <div class="sum-row"><span>Deposit today</span><span><b>${money(q.deposit)}</b></span></div>
        <div class="sum-row"><span>Balance at appointment</span><span>${money(q.balance)}</span></div>
      </div>
      <div class="policy" style="margin-top:16px">
        <h4>Cancellation &amp; deposit policy</h4>
        <ul>
          <li>Your ${money(q.deposit)} deposit is applied to your ${money(q.total)} total. The ${money(q.balance)} balance is due after the groom.</li>
          ${cutoff > new Date() ? `<li>Cancel or reschedule for free until <b>${fDayShort(cutoff)}, ${fTime(cutoff)}</b> (${s.cancelWindowHours} hours before) for a full deposit refund.</li>` : `<li><b>This visit is less than ${s.cancelWindowHours} hours away</b>, so the deposit is non-refundable once paid. If plans change, we'll apply it once to a rescheduled visit.</li>`}
          <li>Inside ${s.cancelWindowHours} hours, the deposit is non-refundable, but we'll apply it once to a rescheduled visit.</li>
          <li>If we can't reach your dog at the appointment (a no-show), the deposit is kept to cover the trip.</li>
          <li>If we ever need to cancel, you get a full refund.</li>
        </ul>
      </div>
      <label class="agree"><input type="checkbox" data-act="agree" data-fk="agree" ${S.agree ? 'checked' : ''}><span>I've read and agree to the cancellation and deposit policy.</span></label>
      <div class="paybox">
        ${STRIPE() ? `<div class="paybox-head"><h4>Payment</h4><span class="pill warn">Stripe test mode</span></div>
        <div id="pay-element"><div class="testcard"><span class="cc" aria-hidden="true"></span><span class="t">Secure Stripe Checkout (test mode)<small>You'll enter a test card on Stripe's page. Use 4242 4242 4242 4242, any future expiry, any CVC and ZIP.</small></span>${I.lock.replace('<svg', '<svg style="width:18px;height:18px;color:#6b766f"')}</div></div>
        <button class="btn btn-clay btn-block" style="margin-top:14px" data-act="pay" data-fk="pay" ${S.agree && !S.paying ? '' : 'disabled'}>${S.paying ? '<span class="spinner" aria-hidden="true"></span> Opening Stripe…' : `Pay ${money(q.deposit)} deposit (test mode)`}</button>
        <p class="demo-line">Stripe TEST MODE: no real card is charged and no money moves.${Store.payments.configured ? '' : ' <b>Stripe isn\'t connected on the server yet, so checkout is unavailable.</b>'}</p>` : `<div class="paybox-head"><h4>Payment</h4><span class="pill warn">Demo checkout</span></div>
        <div id="pay-element"><div class="testcard"><span class="cc" aria-hidden="true"></span><span class="t">Test card •••• 4242<small>Sample card for this demo — no card details are collected</small></span>${I.lock.replace('<svg', '<svg style="width:18px;height:18px;color:#6b766f"')}</div></div>
        <button class="btn btn-clay btn-block" style="margin-top:14px" data-act="pay" data-fk="pay" ${S.agree && !S.paying ? '' : 'disabled'}>${S.paying ? '<span class="spinner" aria-hidden="true"></span> Processing…' : `Pay ${money(q.deposit)} deposit — demo`}</button>
        <p class="demo-line">This is a demo payment. Nothing is charged. Real payments will run through Stripe.</p>`}
      </div>
    </div>`;
  }

  const backBtn = () => `<button type="button" class="btn btn-ghost btn-sm" style="margin-bottom:14px" data-act="back">← Back</button>`;

  function goStep(n) { S.step = n; S.errors = {}; renderBooking({ scrollTop: true }); const h = app.querySelector('#stepArea h2'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } }

  function next() {
    if (S.step === 2) {
      S.errors = validateForm();
      if (Object.keys(S.errors).length) {
        renderBooking();
        const first = app.querySelector('.field.err input, .field.err textarea');
        if (first) { first.focus(); first.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
        return;
      }
    }
    if (!stepValid(S.step)) return;
    goStep(S.step + 1);
  }

  async function pay() {
    const q = quote();
    if (!q || !S.agree || S.paying) return;
    // Re-check the slot is still free right before charging.
    const still = Store.slotsFor(S.time, q.minutes).some(t => t.toISOString() === S.time);
    if (!still) { toast('Sorry, that time was just taken. Please pick another.'); S.time = null; goStep(1); return; }
    S.paying = true; renderBooking();
    if (STRIPE()) {
      try {
        const res = await Payments.StripeTest.startCheckout({ serviceId: q.svc.id, size: S.size, addons: S.addons, start: S.time, form: S.form, expectedDeposit: q.deposit });
        try { sessionStorage.setItem('fernhill-checkout', JSON.stringify({ ...S, paying: false })); } catch (e) { }
        location.href = res.url; // Stripe-hosted Checkout (test mode)
      } catch (err) {
        S.paying = false;
        if (err.code === 'slot_taken') { S.time = null; await Store.sync(); goStep(1); }
        else if (err.code === 'price_changed') { await Store.sync(); renderBooking(); }
        else renderBooking();
        toast(err.message || 'Could not open checkout. Please try again.');
      }
      return;
    }
    const ref = Store.makeRef();
    try {
      const intent = await Payments.createDepositIntent({ amountCents: Math.round(q.deposit * 100), bookingRef: ref });
      const res = await Payments.confirmDeposit(intent);
      if (res.status !== 'succeeded') throw new Error('Payment not completed');
      const f = S.form;
      const b = {
        id: 'b' + Date.now(), ref, createdAt: new Date().toISOString(), seen: false, source: 'online',
        serviceId: q.svc.id, serviceName: q.svc.name, size: S.size, addons: q.addons.map(a => ({ ...a })), minutes: q.minutes,
        start: S.time, total: q.total, deposit: q.deposit, balance: q.balance,
        dog: { name: f.dogName.trim(), breed: f.breed.trim(), age: f.age.trim(), notes: f.dogNotes.trim() },
        customer: { name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim() },
        address: { street: f.street.trim(), unit: f.unit.trim(), city: f.city.trim(), zip: f.zip.trim(), access: f.access.trim() },
        payment: { id: res.id, status: 'succeeded', method: res.method, provider: res.provider, paidAt: res.paidAt },
        status: 'confirmed'
      };
      Store.addBooking(b);
      S = newState();
      location.hash = '#/confirmed/' + b.id;
    } catch (err) {
      S.paying = false; renderBooking(); toast('Payment didn\'t go through. Please try again.');
    }
  }

  /* ---------------- Confirmation ---------------- */
  function renderConfirmed(id) {
    const b = Store.db.bookings.find(x => x.id === id);
    if (!b) { location.hash = '#/'; return; }
    const s = Store.db.settings;
    const end = new Date(new Date(b.start).getTime() + b.minutes * 60e3);
    const cutoff = new Date(new Date(b.start).getTime() - s.cancelWindowHours * 3600e3);
    app.innerHTML = `<div class="wrap"><div class="confirm">
      <div class="check">${I.check}</div>
      <h1>You're booked!</h1>
      <p class="sub">Your ${money(b.deposit)} deposit is in, and ${esc(b.dog.name)}'s visit is on the calendar. A confirmation is on its way to ${esc(b.customer.email)}.</p>
      <div class="card">
        <div class="whenbox"><div class="cal"><div class="m">${fmt(b.start, { month: 'short' })}</div><div class="d">${new Date(b.start).getDate()}</div></div><div><b>${fDayLong(b.start)}</b><small>Arrival ${fTime(b.start)} · done by about ${fTime(end)}</small></div></div>
        <div class="kv"><span>Booking reference</span><span class="ref">${esc(b.ref)}</span></div>
        <div class="kv"><span>Service</span><span>${esc(b.serviceName)}</span></div>
        ${b.addons.length ? `<div class="kv"><span>Add-ons</span><span style="text-align:right">${b.addons.map(a => esc(a.name)).join(', ')}</span></div>` : ''}
        <div class="kv"><span>Dog</span><span>${esc(b.dog.name)} · ${esc(b.dog.breed)}</span></div>
        <div class="kv"><span>Address</span><span style="text-align:right">${esc(b.address.street)}${b.address.unit ? ', ' + esc(b.address.unit) : ''}<br>${esc(b.address.city)} ${esc(b.address.zip)}</span></div>
        <div class="sum-row total"><span>Total</span><span>${money(b.total)}</span></div>
        <div class="kv" style="color:var(--ok);font-weight:650"><span style="color:var(--ok)">Deposit paid</span><span>− ${money(b.deposit)}</span></div>
        <div class="kv" style="font-weight:700"><span style="color:var(--ink)">Balance due at visit</span><span>${money(b.balance)}</span></div>
        <p class="muted" style="font-size:12.5px;margin:8px 0 0">Paid with ${esc(b.payment.method)} ${b.payment.provider === 'stripe-test' ? '(Stripe test mode, no real money moved).' : '(demo payment, nothing was charged).'}</p>
      </div>
      <div class="card">
        <h3 style="font-size:18px;margin-bottom:6px">What happens next</h3>
        <ol class="next-steps">
          <li>We'll text ${esc(b.customer.phone)} the evening before and again when we're on the way.</li>
          <li>Have ${esc(b.dog.name)} ready at arrival time. A quick walk beforehand helps.</li>
          <li>Need to change plans? ${cutoff > new Date(b.createdAt) ? `Free cancellation until ${fDayShort(cutoff)}, ${fTime(cutoff)}.` : `Your deposit can be applied once to a rescheduled visit.`} Call ${BIZ.phone} and mention ${esc(b.ref)}.</li>
        </ol>
        <div class="btn-row">
          <button class="btn btn-primary" data-act="ics" data-id="${b.id}">${I.cal.replace('<svg', '<svg style="width:18px;height:18px"')} Add to calendar</button>
          <a class="btn btn-ghost" href="#/" data-act="again">Book another dog</a>
        </div>
      </div>
      <p class="foot" style="padding-top:8px">${b.payment.provider === 'stripe-test' ? 'Stripe test mode · ' : ''}Demo tip: open the <a href="#/dashboard">groomer dashboard</a> to see this booking arrive.</p>
    </div></div>`;
    window.scrollTo({ top: 0 });
  }

  function downloadIcs(b) {
    const z = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const end = new Date(new Date(b.start).getTime() + b.minutes * 60e3);
    const loc = `${b.address.street}${b.address.unit ? ' ' + b.address.unit : ''}, ${b.address.city} ${b.address.zip}`.replace(/,/g, '\\,');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Fernhill Mobile Grooming//Booking//EN', 'BEGIN:VEVENT', `UID:${b.ref}@fernhill.demo`, `DTSTAMP:${z(new Date())}`, `DTSTART:${z(b.start)}`, `DTEND:${z(end)}`,
      `SUMMARY:${b.serviceName} for ${b.dog.name} — Fernhill Mobile Grooming`, `LOCATION:${loc}`, `DESCRIPTION:Booking ${b.ref}. Balance due at visit: ${money(b.balance)}.`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    a.download = `fernhill-${b.ref}.ics`; document.body.appendChild(a); a.click(); a.remove();
    toast('Calendar file downloaded');
  }

  /* ---------------- Dashboard ---------------- */
  let D = { tab: 'upcoming', openId: null };
  const initials = (n) => n.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
  const statusPill = (b) => ({ confirmed: '<span class="pill green">Deposit paid</span>', completed: '<span class="pill">Completed</span>', cancelled: '<span class="pill clay">Cancelled · refunded</span>', noshow: '<span class="pill warn">No-show · deposit kept</span>' }[b.status]);

  function renderDash() {
    const db = Store.db, now = Date.now();
    const bks = db.bookings.slice().sort((a, b) => new Date(a.start) - new Date(b.start));
    const upcoming = bks.filter(b => b.status === 'confirmed' && new Date(b.start).getTime() + b.minutes * 60e3 > now);
    const past = bks.filter(b => !upcoming.includes(b)).reverse();
    const kept = db.bookings.filter(b => b.status !== 'cancelled');
    const depTotal = kept.reduce((a, b) => a + b.deposit, 0);
    const balDue = upcoming.reduce((a, b) => a + b.balance, 0);
    const weekEnd = Store.addDays(Store.dayStart(new Date()), 7).getTime();
    const thisWeek = upcoming.filter(b => new Date(b.start).getTime() < weekEnd).length;
    const nextB = upcoming[0];
    const newCount = db.bookings.filter(b => !b.seen).length;

    let body = '';
    if (D.tab === 'upcoming' || D.tab === 'past') {
      const list = D.tab === 'upcoming' ? upcoming : past;
      if (!list.length) body = `<div class="empty">${D.tab === 'upcoming' ? 'No upcoming bookings yet. New bookings from your page show up here.' : 'Nothing here yet.'}</div>`;
      else {
        const groups = [];
        list.forEach(b => { const k = Store.dayStart(b.start).getTime(); let g = groups.find(x => x.k === k); if (!g) groups.push(g = { k, items: [] }); g.items.push(b); });
        body = groups.map(g => `<div class="daygroup"><h3>${sameDay(g.k, new Date()) ? 'Today · ' : sameDay(g.k, Store.addDays(new Date(), 1)) ? 'Tomorrow · ' : ''}${fDayLong(g.k)}</h3>${g.items.map(b => `
          <button class="bk" data-act="open" data-id="${b.id}">
            <span class="time">${fTime(b.start)}<small>${dur(b.minutes)}</small></span>
            <span class="avatar" aria-hidden="true">${esc(b.dog.name[0] || '?')}</span>
            <span class="who"><span class="l1"><b>${esc(b.dog.name)}</b> <span class="muted" style="font-size:13.5px">· ${esc(b.dog.breed)}</span></span><span class="l2" style="display:block">${esc(b.serviceName)} · ${esc(b.customer.name)} · ${esc(b.address.street)}</span></span>
            <span class="right">${!b.seen ? '<span class="new" style="display:block">New</span>' : ''}<b style="color:var(--forest)">${money(b.total)}</b><span style="display:block;font-size:12.5px;color:${b.status === 'cancelled' ? 'var(--clay)' : 'var(--ok)'}">${b.status === 'cancelled' ? 'refunded' : money(b.deposit) + ' paid'}</span></span>
          </button>`).join('')}</div>`).join('');
      }
    } else if (D.tab === 'services') {
      const s = db.settings;
      body = `<p class="muted" style="margin:-4px 0 12px;font-size:14px">Changes save automatically and show on your booking page right away. Prices are for small dogs; size upcharges apply where marked.</p>
      <table class="tbl"><thead><tr><th>Service</th><th>Price</th><th>Duration (min)</th><th>Size pricing</th><th>On booking page</th></tr></thead><tbody>
      ${db.services.map(v => `<tr>
        <td class="first"><div><div class="svcn">${esc(v.name)}</div><div class="svcd">${esc(v.desc)}</div></div></td>
        <td data-l="Price"><label class="sr-only" for="p-${v.id}">${esc(v.name)} price</label>$ <input type="number" min="1" step="1" id="p-${v.id}" data-act="svcedit" data-id="${v.id}" data-k="price" value="${v.price}"></td>
        <td data-l="Duration"><label class="sr-only" for="m-${v.id}">${esc(v.name)} duration in minutes</label><input type="number" min="10" step="5" id="m-${v.id}" data-act="svcedit" data-id="${v.id}" data-k="minutes" value="${v.minutes}"></td>
        <td data-l="Size pricing">${v.sizePricing ? 'Yes' : 'Flat'}</td>
        <td data-l="On booking page"><label class="switch"><input type="checkbox" data-act="svcedit" data-id="${v.id}" data-k="active" ${v.active ? 'checked' : ''} aria-label="Show ${esc(v.name)} on booking page"><span></span></label></td>
      </tr>`).join('')}</tbody></table>
      <div class="section-label">Size upcharges</div>
      <div class="stats">${Store.SIZES.map(z => `<div class="stat"><label class="k" for="u-${z.id}">${z.name} <span style="text-transform:none;font-weight:500">${z.range}</span></label><div style="margin-top:6px">+$ <input type="number" min="0" step="1" id="u-${z.id}" data-act="upedit" data-id="${z.id}" value="${s.sizeUpcharge[z.id]}" style="width:80px;border:1.5px solid #d8cfbf;border-radius:8px;padding:7px 8px"></div></div>`).join('')}</div>
      <div class="section-label">Add-ons</div>
      <div class="stats">${db.addons.map(a => `<div class="stat"><div class="k">${esc(a.name)}</div><div class="v">${money(a.price)}</div></div>`).join('')}</div>`;
    } else {
      const s = db.settings;
      body = `<div class="card settings">
        <h2 style="font-size:20px">Deposit &amp; booking rules</h2>
        <div class="field"><label for="r-dp">Deposit (% of total)</label><input type="number" id="r-dp" min="0" max="100" data-act="rule" data-k="depositPercent" value="${s.depositPercent}"><div class="hint">Rounded to the nearest $5.</div></div>
        <div class="field"><label for="r-dm">Minimum deposit ($)</label><input type="number" id="r-dm" min="0" data-act="rule" data-k="depositMin" value="${s.depositMin}"></div>
        <div class="field"><label for="r-cw">Free cancellation window (hours before)</label><input type="number" id="r-cw" min="0" data-act="rule" data-k="cancelWindowHours" value="${s.cancelWindowHours}"></div>
        <div class="field"><label for="r-tb">Travel buffer between visits (minutes)</label><input type="number" id="r-tb" min="0" step="5" data-act="rule" data-k="travelBufferMin" value="${s.travelBufferMin}"></div>
        <div class="field"><label for="r-mn">Minimum notice (hours)</label><input type="number" id="r-mn" min="0" data-act="rule" data-k="minNoticeHours" value="${s.minNoticeHours}"></div>
        <div class="section-label" style="margin:6px 0 0">Weekly hours</div>
        <div style="font-size:14.5px;display:grid;gap:4px">${[1, 2, 3, 4, 5, 6, 0].map(d => { const h = s.hours[d]; const t = (m) => fTime(new Date(2026, 0, 1, 0, m)); return `<div class="kv"><span>${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d]}</span><span>${h ? t(h[0]) + ' – ' + t(h[1]) : 'Closed'}</span></div>`; }).join('')}</div>
        <div style="border-top:1px solid var(--line);padding-top:14px">
          <div class="kv"><span>Payments</span><span class="pill warn">${STRIPE() ? 'Stripe test mode' : 'Demo mode'}</span></div>
          <p class="muted" style="font-size:13.5px;margin:6px 0 12px">${STRIPE() ? 'New online bookings pay their deposit through Stripe Checkout in test mode, so no real money moves. Sample bookings are demo data. Going live (real payouts to your bank) needs Stripe account verification first.' : 'Deposits are simulated. Connecting Stripe (test mode first) turns these into real deposits paid out to your bank.'}</p>
          <button class="btn btn-ghost btn-sm" data-act="reset">Reset demo data</button>
        </div>
      </div>`;
    }

    app.innerHTML = `${TEST_BANNER()}<div class="wrap">
      <div class="dash-head"><div><h1>Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, Fernhill</h1><p>${fDayLong(new Date())} · <span class="pill warn" style="vertical-align:1px">${STRIPE() ? 'Stripe test mode' : 'Demo dashboard'}</span>${newCount ? ` · <b style="color:var(--clay)">${newCount} new booking${newCount > 1 ? 's' : ''}</b>` : ''}</p></div>
      <a class="btn btn-primary btn-sm" href="#/">+ New booking</a></div>
      <div class="stats">
        <div class="stat"><div class="k">Upcoming</div><div class="v">${upcoming.length}</div><div class="s">${thisWeek} in the next 7 days</div></div>
        <div class="stat"><div class="k">Deposits collected</div><div class="v">${money(depTotal)}</div><div class="s">${kept.length} paid bookings</div></div>
        <div class="stat"><div class="k">Balance due</div><div class="v">${money(balDue)}</div><div class="s">On upcoming visits</div></div>
        <div class="stat"><div class="k">Next visit</div><div class="v" style="font-size:20px">${nextB ? fTime(nextB.start) : '—'}</div><div class="s">${nextB ? esc(fDayShort(nextB.start)) + ' · ' + esc(nextB.dog.name) : 'Nothing scheduled'}</div></div>
      </div>
      <div class="tabs" role="tablist">${[['upcoming', 'Upcoming'], ['past', 'Past & cancelled'], ['services', 'Services & prices'], ['rules', 'Deposit rules']].map(([k, l]) => `<button class="tab" role="tab" aria-selected="${D.tab === k}" data-act="tab" data-id="${k}">${l}</button>`).join('')}</div>
      <div role="tabpanel">${body}</div>
    </div>${D.openId ? drawer(db.bookings.find(b => b.id === D.openId)) : ''}`;
    if (D.openId) { const x = app.querySelector('.x'); if (x) x.focus(); }
  }

  function drawer(b) {
    if (!b) return '';
    const sz = Store.SIZES.find(z => z.id === b.size);
    const addr = `${b.address.street}${b.address.unit ? ', ' + b.address.unit : ''}, ${b.address.city}, TX ${b.address.zip}`;
    const end = new Date(new Date(b.start).getTime() + b.minutes * 60e3);
    const upcoming = b.status === 'confirmed';
    return `<div class="scrim" data-act="close-scrim"><div class="drawer" role="dialog" aria-modal="true" aria-labelledby="dTitle">
      <div class="drawer-head"><div><div class="muted" style="font-size:13px">Booking <span class="ref">${esc(b.ref)}</span></div><h2 id="dTitle">${esc(b.dog.name)} · ${esc(b.serviceName)}</h2><div style="margin-top:6px">${statusPill(b)}</div></div><button class="x" data-act="close" aria-label="Close">×</button></div>
      <div class="dsec"><h4>When</h4><p><b>${fDayLong(b.start)}</b></p><p>${fTime(b.start)} – ${fTime(end)} (${dur(b.minutes)})</p></div>
      <div class="dsec"><h4>Dog</h4><p><b>${esc(b.dog.name)}</b> · ${esc(b.dog.breed)}${b.dog.age ? ' · ' + esc(b.dog.age) : ''}</p><p>${esc(sz ? sz.name + ' (' + sz.range + ')' : '')}</p>${b.dog.notes ? `<p class="note" style="margin-top:8px">${I.info}<span>${esc(b.dog.notes)}</span></p>` : ''}</div>
      <div class="dsec"><h4>Customer</h4><p><b>${esc(b.customer.name)}</b></p><p><a href="tel:${esc(b.customer.phone.replace(/[^\d+]/g, ''))}">${esc(b.customer.phone)}</a></p><p><a href="mailto:${esc(b.customer.email)}">${esc(b.customer.email)}</a></p></div>
      <div class="dsec"><h4>Visit address</h4><p>${esc(addr)}</p>${b.address.access ? `<p class="muted" style="font-size:14px">Access: ${esc(b.address.access)}</p>` : ''}<p style="margin-top:8px"><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}" target="_blank" rel="noopener">Open in Maps ↗</a></p></div>
      <div class="dsec"><h4>Payment</h4>
        <div class="kv"><span>${esc(b.serviceName)}</span><span>${money(b.total - b.addons.reduce((a, x) => a + x.price, 0))}</span></div>
        ${b.addons.map(a => `<div class="kv"><span>${esc(a.name)}</span><span>${money(a.price)}</span></div>`).join('')}
        <div class="kv" style="border-top:1px solid var(--line);margin-top:4px;padding-top:8px;font-weight:700"><span style="color:var(--ink)">Total</span><span>${money(b.total)}</span></div>
        <div class="kv"><span>Deposit</span><span style="color:${b.status === 'cancelled' ? 'var(--clay)' : 'var(--ok)'};font-weight:650">${money(b.deposit)} ${b.status === 'cancelled' ? 'refunded' : 'paid'}</span></div>
        <div class="kv"><span>Balance ${b.status === 'completed' ? 'collected' : 'due at visit'}</span><span>${b.status === 'cancelled' ? '—' : money(b.balance)}</span></div>
        <p class="muted" style="font-size:12.5px;margin:6px 0 0">${esc(b.payment.method)} · ${b.payment.provider === 'stripe-test' ? 'Stripe test mode' : 'demo'} · ${esc(b.payment.id)}</p>
      </div>
      ${upcoming ? `<div style="display:grid;gap:8px;margin-top:4px">
        <button class="btn btn-primary" data-act="complete" data-id="${b.id}">Mark as completed</button>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <button class="btn btn-ghost btn-sm" data-act="noshow" data-id="${b.id}">No-show (keep deposit)</button>
          <button class="btn btn-ghost btn-sm" data-act="cancel" data-id="${b.id}">Cancel &amp; refund</button>
        </div></div>` : ''}
    </div></div>`;
  }

  /* ---------------- Events ---------------- */
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act, id = el.dataset.id;
    switch (act) {
      case 'size': S.size = id; renderBooking(); break;
      case 'svc': S.serviceId = id; S.time = null; S.date = null; if (!S.size) S.size = ''; renderBooking(); break;
      case 'next': next(); break;
      case 'back': goStep(Math.max(0, S.step - 1)); break;
      case 'goto': goStep(+id); break;
      case 'day': S.date = id; S.time = null; renderBooking(); break;
      case 'time': S.time = id; renderBooking(); break;
      case 'pay': pay(); break;
      case 'ics': downloadIcs(Store.db.bookings.find(b => b.id === id)); break;
      case 'tab': D.tab = id; D.openId = null; renderDash(); break;
      case 'open': D.openId = id; Store.updateBooking(id, { seen: true }); renderDash(); break;
      case 'close': D.openId = null; renderDash(); break;
      case 'close-scrim': if (e.target === el) { D.openId = null; renderDash(); } break;
      case 'complete': Store.updateBooking(id, { status: 'completed' }); D.openId = null; renderDash(); toast('Marked as completed'); break;
      case 'noshow': Store.updateBooking(id, { status: 'noshow' }); D.openId = null; renderDash(); toast('Marked as no-show. Deposit kept.'); break;
      case 'cancel': {
        const b = Store.db.bookings.find(x => x.id === id);
        if (!confirm(`Cancel ${b.dog.name}'s visit and refund the ${money(b.deposit)} deposit?`)) break;
        el.disabled = true;
        if (b.payment.provider === 'stripe-test') {
          try { const nb = await Payments.StripeTest.refundBooking(id); Store.mergeServerBooking(nb); Store.save(); D.openId = null; renderDash(); toast('Booking cancelled. Test deposit refunded in Stripe.'); }
          catch (err) { el.disabled = false; toast(err.message); }
          break;
        }
        const r = await Payments.refundDeposit(b.payment.id);
        Store.updateBooking(id, { status: 'cancelled', payment: { ...b.payment, refundId: r.id, status: 'refunded' } });
        D.openId = null; renderDash(); toast('Booking cancelled. Deposit refunded (demo).'); break;
      }
      case 'reset': if (confirm('Reset all demo bookings and prices?')) { await Store.reset(); S = newState(); D = { tab: 'upcoming', openId: null }; renderDash(); toast('Demo data reset'); } break;
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target, act = el.dataset.act;
    if (act === 'addon') { const id = el.dataset.id; S.addons = el.checked ? [...new Set([...S.addons, id])] : S.addons.filter(x => x !== id); renderBooking(); }
    else if (act === 'agree') { S.agree = el.checked; renderBooking(); }
    else if (act === 'svcedit') {
      const v = Store.db.services.find(s => s.id === el.dataset.id), k = el.dataset.k;
      if (k === 'active') { if (!el.checked && Store.db.services.filter(s => s.active).length === 1) { el.checked = true; toast('Keep at least one service on your booking page'); return; } v.active = el.checked; }
      else { const n = Math.round(Number(el.value)); const min = k === 'price' ? 1 : 10; if (!Number.isFinite(n) || n < min) { el.value = v[k]; toast(k === 'price' ? 'Price must be at least $1' : 'Duration must be at least 10 minutes'); return; } v[k] = n; el.value = n; }
      Store.save(); toast('Saved');
    } else if (act === 'upedit') {
      const n = Math.round(Number(el.value)); if (!Number.isFinite(n) || n < 0) { el.value = Store.db.settings.sizeUpcharge[el.dataset.id]; return; }
      Store.db.settings.sizeUpcharge[el.dataset.id] = n; Store.save(); toast('Saved');
    } else if (act === 'rule') {
      const k = el.dataset.k, s = Store.db.settings, n = Math.round(Number(el.value));
      if (!Number.isFinite(n) || n < 0 || (k === 'depositPercent' && n > 100)) { el.value = s[k]; toast('Please enter a valid number'); return; }
      s[k] = n; Store.save(); toast('Saved');
    }
  });

  document.addEventListener('input', (e) => {
    const el = e.target, k = el.dataset.field;
    if (!k) return;
    let v = el.value;
    if (k === 'zip') { v = v.replace(/\D/g, '').slice(0, 5); if (v !== el.value) el.value = v; }
    S.form[k] = v;
    if (S.errors[k]) { // clear error as soon as it's fixed
      const ok = !validateForm()[k];
      if (ok) { delete S.errors[k]; const f = el.closest('.field'); f.classList.remove('err'); el.removeAttribute('aria-invalid'); }
    }
  });
  document.addEventListener('submit', (e) => { if (e.target.id === 'detailsForm') { e.preventDefault(); next(); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && D.openId) { D.openId = null; renderDash(); } });

  /* ---------------- Router ---------------- */
  function route() {
    const h = location.hash || '#/';
    if (h.startsWith('#/dashboard')) { renderTop('dash'); document.title = 'Dashboard — Fernhill Mobile Grooming (demo)'; renderDash(); window.scrollTo({ top: 0 }); }
    else if (h.startsWith('#/return')) { renderTop('book'); document.title = 'Confirming your deposit — Fernhill Mobile Grooming'; renderReturn(); }
    else if (h.startsWith('#/review')) {
      let saved = null; try { saved = JSON.parse(sessionStorage.getItem('fernhill-checkout') || 'null'); } catch (e) { }
      if (saved && saved.time) { S = { ...newState(), ...saved, paying: false, step: 3 }; }
      history.replaceState(null, '', location.pathname);
      renderTop('book'); renderBooking({ scrollTop: true });
      if (saved) toast('Checkout canceled. You were not charged.');
    }
    else if (h.startsWith('#/confirmed/')) { renderTop('book'); document.title = 'Booking confirmed — Fernhill Mobile Grooming'; renderConfirmed(h.split('/')[2]); }
    else { renderTop('book'); document.title = 'Book a visit — Fernhill Mobile Grooming'; renderBooking({ scrollTop: true }); }
  }
  async function renderReturn() {
    const sid = new URLSearchParams(location.search).get('session_id');
    if (!sid) { location.hash = '#/'; return; }
    app.innerHTML = `${TEST_BANNER()}<div class="wrap"><div class="card" style="max-width:520px;margin:40px auto;text-align:center"><span class="spinner" aria-hidden="true" style="border-color:var(--line);border-top-color:var(--forest)"></span><h2 style="margin-top:12px">Confirming your deposit…</h2><p class="lead">This takes a few seconds.</p></div></div>`;
    for (let i = 0; i < 12; i++) {
      try {
        const r = await Payments.StripeTest.checkStatus(sid);
        if (r.status === 'paid' && r.booking) {
          Store.mergeServerBooking(r.booking); Store.save();
          try { sessionStorage.removeItem('fernhill-checkout'); } catch (e) { }
          S = newState();
          history.replaceState(null, '', location.pathname + '#/confirmed/' + r.booking.id);
          route(); return;
        }
      } catch (e) { }
      await new Promise(res => setTimeout(res, 1500));
    }
    app.innerHTML = `${TEST_BANNER()}<div class="wrap"><div class="card" style="max-width:520px;margin:40px auto;text-align:center"><h2>We couldn't confirm the payment yet</h2><p class="lead">If you completed checkout, your booking will appear shortly. Call ${BIZ.phone} if you have questions.</p><a class="btn btn-primary" href="#/" onclick="history.replaceState(null,'',location.pathname)">Back to booking</a></div></div>`;
  }

  window.addEventListener('hashchange', route);
  Store.sync().finally(route);
})();
