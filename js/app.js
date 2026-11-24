// Forma – główny plik aplikacji: logowanie, profil, dzień, kalendarz, aktywność
import { supabase, db } from './db.js';
import { S, app } from './state.js';
import { safe, friendlyError } from './errors.js';
import { LIFESTYLES, GOALS, MEALS, computeTargets, sum, budget, weeklyCheck, r0, r1 } from './calc.js';
import { ACTIVITIES, QUICK_ACTS, activityKcal } from './activities.js';
import { openAddMeal, openEditEntry, renderBase, macroLine, f1 } from './meals.js';
import { getKey, setKey, getModel, setModel, DEFAULT_MODEL } from './gemini.js';
import { $, $$, esc, num, todayStr, addDays, fmtLong, fmtShort, pad, toast, openSheet, closeSheet } from './ui.js';

const main = () => $('#app');
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const PROFILE_COLS = ['sex', 'age', 'height_cm', 'weight_kg', 'lifestyle', 'goal', 'kcal_target', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'targets_manual'];
const profileCols = p => Object.fromEntries(PROFILE_COLS.filter(k => p[k] !== undefined).map(k => [k, p[k]]));
const targetsOnly = t => ({ kcal_target: t.kcal_target, protein_g: t.protein_g, carbs_g: t.carbs_g, fat_g: t.fat_g, fiber_g: t.fiber_g });

/* ---------- Nawigacja ---------- */
function setTabbar(show) {
  $('#tabbar').hidden = !show;
  document.body.classList.toggle('has-tabbar', show);
}

function go(tab, keepScroll = false) {
  S.tab = tab;
  $$('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const el = main();
  el.onclick = null;
  el.oninput = null;
  if (!keepScroll) window.scrollTo(0, 0);
  const render = { day: renderDay, cal: renderCalendar, base: () => renderBase(el), profile: renderProfile }[tab];
  safe(render)();
}
app.go = go;
app.refresh = () => go(S.tab, true);

/* ---------- Start ---------- */
async function boot() {
  $('#tabbar').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); };
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    if (!t || !main().contains(t)) return;
    const h = ACT[t.dataset.act];
    if (h) safe(h)(t);
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  const { data } = await supabase.auth.getSession();
  S.session = data.session;
  supabase.auth.onAuthStateChange((_ev, session) => {
    const changed = !!session !== !!S.session;
    S.session = session;
    if (changed) setTimeout(start, 0);
  });
  start();
}

async function start() {
  closeSheet();
  if (!S.session) { setTabbar(false); return renderAuth('login'); }
  setTabbar(false);
  main().innerHTML = '<div class="loading">Ładowanie…</div>';
  try {
    [S.profile, S.foods] = await Promise.all([db.getProfile(), db.listFoods()]);
  } catch (e) {
    main().innerHTML = `<div class="card msg warn">${esc(friendlyError(e))}</div><button class="btn" data-act="logout">Wyloguj</button>`;
    return;
  }
  if (!S.profile || !S.profile.kcal_target) {
    S.onb = { step: 1, p: { lifestyle: 'light', goal: 'cut' } };
    return renderOnboarding();
  }
  setTabbar(true);
  go('day');
}

/* ---------- Logowanie ---------- */
function renderAuth(mode) {
  const login = mode === 'login';
  main().innerHTML = `<div class="auth">
    <div class="logo">F</div><h1>Forma</h1>
    <p class="muted">Jedzenie, aktywność i trening w jednym miejscu.</p>
    <form id="auth-form" class="card">
      <h2>${login ? 'Zaloguj się' : 'Załóż konto'}</h2>
      <label>E-mail<input type="email" name="email" autocomplete="email" required></label>
      <label>Hasło<input type="password" name="password" autocomplete="${login ? 'current-password' : 'new-password'}" minlength="6" required></label>
      ${login ? '' : '<p class="small muted">Hasło: co najmniej 6 znaków. Zapisz je w menedżerze haseł.</p>'}
      <button class="btn primary big" type="submit">${login ? 'Zaloguj się' : 'Załóż konto'}</button>
    </form>
    <button class="link" id="auth-switch">${login ? 'Pierwszy raz? Załóż konto' : 'Masz już konto? Zaloguj się'}</button>
  </div>`;
  $('#auth-switch').onclick = () => renderAuth(login ? 'register' : 'login');
  $('#auth-form').onsubmit = safe(async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const email = String(f.get('email')).trim(), password = String(f.get('password'));
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      if (login) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          toast('Konto założone. Kliknij link w mailu od Supabase, a potem zaloguj się.');
          renderAuth('login');
        }
      }
    } finally {
      btn.disabled = false;
    }
  });
}

/* ---------- Pierwsze uruchomienie / zmiana danych ---------- */
const radio = (name, val, label, cur) =>
  `<label class="segbtn"><input type="radio" name="${name}" value="${val}" ${cur === val ? 'checked' : ''}><span>${label}</span></label>`;
const radioCard = (name, val, label, desc, cur) =>
  `<label class="rcard"><input type="radio" name="${name}" value="${val}" ${cur === val ? 'checked' : ''}><div><b>${label}</b><small>${desc}</small></div></label>`;

function renderOnboarding() {
  const o = S.onb, p = o.p, el = main();
  el.onclick = null;
  window.scrollTo(0, 0);
  const cancel = o.edit ? '<button class="btn" type="button" data-k="cancel">Anuluj</button>' : '';

  if (o.step === 1) {
    el.innerHTML = `<div class="onb"><div class="steps">Krok 1 z 3</div>
      <h1>${o.edit ? 'Twoje dane' : 'Poznajmy się 👋'}</h1>
      <p class="muted">Na tej podstawie policzę Twoje dzienne zapotrzebowanie.</p>
      <form id="onb" class="card" novalidate>
        <div class="field"><span>Płeć</span><div class="seg">${radio('sex', 'f', 'Kobieta', p.sex)}${radio('sex', 'm', 'Mężczyzna', p.sex)}</div></div>
        <div class="grid3">
          <label>Wiek<input name="age" inputmode="numeric" value="${p.age ?? ''}" placeholder="lata"></label>
          <label>Wzrost<input name="height_cm" inputmode="decimal" value="${p.height_cm ?? ''}" placeholder="cm"></label>
          <label>Waga<input name="weight_kg" inputmode="decimal" value="${p.weight_kg != null ? f1(p.weight_kg) : ''}" placeholder="kg"></label>
        </div>
        <div class="field"><span>Tryb życia na co dzień <small class="muted">(bez treningów – te wpisujesz osobno)</small></span>
          ${LIFESTYLES.map(l => radioCard('lifestyle', l.id, l.label, l.desc, p.lifestyle)).join('')}</div>
        <button class="btn primary big" type="submit">Dalej</button>${cancel}
      </form></div>`;
    $('#onb').onsubmit = e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const v = {
        sex: f.get('sex'), age: r0(num(f.get('age'))), height_cm: r1(num(f.get('height_cm'))),
        weight_kg: r1(num(f.get('weight_kg'))), lifestyle: f.get('lifestyle'),
      };
      if (!v.sex) return toast('Wybierz płeć', 'err');
      if (v.age < 14 || v.age > 100) return toast('Podaj wiek (14–100 lat)', 'err');
      if (v.height_cm < 120 || v.height_cm > 230) return toast('Podaj wzrost w cm (np. 168)', 'err');
      if (v.weight_kg < 35 || v.weight_kg > 300) return toast('Podaj wagę w kg (np. 65)', 'err');
      if (!v.lifestyle) return toast('Wybierz tryb życia', 'err');
      Object.assign(p, v);
      o.step = 2;
      renderOnboarding();
    };
  }

  if (o.step === 2) {
    el.innerHTML = `<div class="onb"><div class="steps">Krok 2 z 3</div>
      <h1>Jaki masz cel?</h1><p class="muted">Możesz go później zmienić w Profilu.</p>
      <form id="onb" class="card">
        ${GOALS.map(g => radioCard('goal', g.id, g.label, g.desc, p.goal)).join('')}
        <button class="btn primary big" type="submit">Dalej</button>
        <button class="btn" type="button" data-k="back">Wstecz</button>
      </form></div>`;
    $('#onb').onsubmit = e => {
      e.preventDefault();
      p.goal = new FormData(e.target).get('goal') || 'cut';
      o.step = 3;
      renderOnboarding();
    };
  }

  if (o.step === 3) {
    const t = computeTargets(p);
    el.innerHTML = `<div class="onb"><div class="steps">Krok 3 z 3</div>
      <h1>Twoje dzienne cele</h1>
      <div class="card">
        <div class="stats five">
          <div><b>${t.kcal_target}</b><span>kcal</span></div><div><b>${t.protein_g} g</b><span>białko</span></div>
          <div><b>${t.carbs_g} g</b><span>węgle</span></div><div><b>${t.fat_g} g</b><span>tłuszcz</span></div>
          <div><b>${t.fiber_g} g</b><span>błonnik</span></div>
        </div>
        <p class="small muted">Twój organizm zużywa ok. <b>${t.tdee} kcal</b> dziennie (bez treningów).
        ${p.goal === 'cut' ? 'Na redukcji jesz o 20% mniej – to bezpieczne tempo, ok. 0,3–0,5 kg na tydzień. Dużo białka chroni mięśnie.' : p.goal === 'gain' ? 'Przy budowie mięśni jesz ok. 10% więcej.' : ''}
        Za każdy trening limit kalorii na dany dzień rośnie o połowę spalonych kalorii.</p>
        <p class="small muted">To wartości orientacyjne. Jeśli masz choroby przewlekłe, jesteś w ciąży lub karmisz – skonsultuj cele z lekarzem lub dietetykiem.</p>
        <button class="btn primary big" data-k="save">Zaczynamy!</button>
        <button class="btn" data-k="back">Wstecz</button>
      </div></div>`;
  }

  el.onclick = safe(async e => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    if (b.dataset.k === 'back') { o.step--; renderOnboarding(); }
    if (b.dataset.k === 'cancel') { S.onb = null; setTabbar(true); go('profile'); }
    if (b.dataset.k === 'save') {
      b.disabled = true;
      try {
        S.profile = await db.saveProfile({ ...profileCols(p), ...targetsOnly(computeTargets(p)), targets_manual: false });
        await db.logWeight(todayStr(), p.weight_kg);
      } finally { b.disabled = false; }
      const wasEdit = o.edit;
      S.onb = null;
      setTabbar(true);
      go(wasEdit ? 'profile' : 'day');
      toast(wasEdit ? 'Zapisano ✔' : 'Gotowe! Dodaj pierwszy posiłek 🙂');
    }
  });
}

/* ---------- Dzień ---------- */
const mbar = (label, v, t, cls) => `<div class="mbar">
  <div class="mb-top"><span>${label}</span><span><b>${r0(v)}</b> / ${t} g</span></div>
  <div class="track"><div class="fill ${cls}" style="width:${t ? Math.min(100, (v / t) * 100) : 0}%"></div></div></div>`;
const amtTxt = e => (e.amount_unit === 'g' ? `${r0(e.amount)} g` : `${f1(e.amount ?? 1)} szt.`);

async function renderDay() {
  const d = S.date, isToday = d === todayStr(), el = main();
  if (!$('.day', el)) el.innerHTML = '<div class="loading">Ładowanie…</div>';
  const from = addDays(d, -7);
  const [E, A] = await Promise.all([db.entriesRange(from, d), db.actsRange(from, d)]);
  if (S.tab !== 'day' || S.date !== d) return;

  const entries = E.filter(e => e.date === d), acts = A.filter(a => a.date === d);
  S.dayEntries = entries;
  S.dayActs = acts;
  const p = S.profile, tot = sum(entries);
  const actK = acts.reduce((s, a) => s + (+a.kcal || 0), 0);
  const actMin = acts.reduce((s, a) => s + (+a.minutes || 0), 0);
  const B = budget(p, actK), left = B - tot.kcal;
  const end = isToday ? addDays(d, -1) : d, start = addDays(end, -6);
  const wk = weeklyCheck(E.filter(e => e.date >= start && e.date <= end), A.filter(a => a.date >= start && a.date <= end), p);
  const known = new Set(MEALS.map(m => m.id));
  const groups = MEALS.map(m => ({ ...m, items: entries.filter(e => (known.has(e.meal) ? e.meal : 'przekaska') === m.id) })).filter(g => g.items.length);
  const hasWarn = wk.msgs.some(m => m.lvl === 'warn');

  const weekCard = `<section class="card week"><div class="sec-h"><h3>Ostatnie 7 dni</h3><span class="muted small">${isToday ? 'bez dzisiaj' : 'do tego dnia'}</span></div>
    ${wk.msgs.map(m => `<div class="msg ${m.lvl}">${m.lvl === 'warn' ? '⚠️' : m.lvl === 'ok' ? '✅' : 'ℹ️'} ${esc(m.text)}</div>`).join('')}
    ${wk.avg ? `<div class="small muted">Średnio dziennie: ${macroLine(wk.avg)}</div>` : ''}</section>`;

  el.innerHTML = `<div class="day">
    <header class="dayhead">
      <button class="iconbtn" data-act="prev" aria-label="Poprzedni dzień">‹</button>
      <div class="dh-mid"><div class="dh-title">${isToday ? 'Dziś' : esc(cap(fmtLong(d).split(',')[0]))}</div>
        <div class="dh-sub">${esc(fmtLong(d))}</div>
        ${isToday ? '' : '<button class="link small" data-act="today">wróć do dziś</button>'}</div>
      <button class="iconbtn" data-act="next" aria-label="Następny dzień">›</button>
    </header>

    <section class="card hero">
      <div class="hero-top">
        <div><div class="big ${left < 0 ? 'neg' : ''}">${Math.abs(r0(left))}</div><div class="muted">${left < 0 ? 'kcal ponad limit' : 'kcal zostało'}</div></div>
        <div class="hero-side"><div><b>${r0(tot.kcal)}</b> zjedzone</div><div><b>${p.kcal_target}</b> cel</div>
          ${actK ? `<div><b>+${r0(actK * 0.5)}</b> za aktywność</div>` : ''}</div>
      </div>
      <div class="track big"><div class="fill ${left < 0 ? 'over' : 'kcal'}" style="width:${B ? Math.min(100, (tot.kcal / B) * 100) : 0}%"></div></div>
      <div class="macros">${mbar('Białko', tot.protein, p.protein_g, 'protein')}${mbar('Węgle', tot.carbs, p.carbs_g, 'carbs')}
        ${mbar('Tłuszcz', tot.fat, p.fat_g, 'fat')}${mbar('Błonnik', tot.fiber, p.fiber_g, 'fiber')}</div>
    </section>

    <div class="btnrow"><button class="btn primary big" data-act="addMeal">📷 Dodaj posiłek</button><button class="btn big" data-act="addAct">🏃 Aktywność</button></div>
    ${hasWarn ? weekCard : ''}

    ${groups.length ? groups.map(g => `<section class="card"><div class="sec-h"><h3>${g.label}</h3><span class="muted">${r0(sum(g.items).kcal)} kcal</span></div>
      ${g.items.map(e => `<button class="row" data-act="entry" data-id="${e.id}"><div><div class="r-name">${esc(e.name)}</div>
        <div class="r-sub">${amtTxt(e)} · B ${f1(e.protein)} · W ${f1(e.carbs)} · T ${f1(e.fat)}</div></div><span class="kc">${r0(e.kcal)}</span></button>`).join('')}
      </section>`).join('')
      : '<div class="empty">Brak posiłków w tym dniu.<br>Kliknij „Dodaj posiłek” i zrób zdjęcie talerza.</div>'}

    ${acts.length ? `<section class="card"><div class="sec-h"><h3>Aktywność</h3><span class="muted">${r0(actMin)} min · ${r0(actK)} kcal</span></div>
      ${acts.map(a => `<button class="row" data-act="act" data-id="${a.id}"><div><div class="r-name">${esc(a.label)}</div>
        <div class="r-sub">${a.steps ? a.steps + ' kroków' : r0(a.minutes) + ' min'}${a.note ? ' · ' + esc(a.note) : ''}</div></div><span class="kc">${r0(a.kcal)} kcal</span></button>`).join('')}
      </section>` : ''}

    ${hasWarn ? '' : weekCard}
  </div>`;
}

/* ---------- Aktywność ---------- */
function openActivity(existing) {
  const w = S.profile.weight_kg;
  const sh = openSheet(`<h2>${existing ? 'Edytuj aktywność' : 'Dodaj aktywność'}</h2>
    ${existing ? '' : `<div class="chips">${QUICK_ACTS.map((q, i) => `<button class="chip" data-q="${i}">${q.label}</button>`).join('')}</div>`}
    <label>Rodzaj<select data-k="type">${ACTIVITIES.map(a => `<option value="${a.id}">${a.label}</option>`).join('')}</select></label>
    <label data-k="minL">Czas (minuty)<input data-k="min" inputmode="numeric" value="${existing?.minutes ?? 60}"></label>
    <label data-k="stepsL" hidden>Liczba kroków<input data-k="steps" inputmode="numeric" value="${existing?.steps ?? ''}"></label>
    <label>Spalone kalorie<input data-k="kcal" inputmode="numeric" value="${existing ? r0(existing.kcal) : ''}"></label>
    <p class="muted small" data-k="hint"></p>
    <label>Notatka (opcjonalnie)<input data-k="note" value="${esc(existing?.note || '')}" placeholder="np. joga na siłowni"></label>
    <button class="btn primary" data-k="save">Zapisz</button>
    ${existing ? '<button class="btn danger" data-k="del">Usuń</button>' : ''}`);
  const typeSel = $('[data-k=type]', sh), minI = $('[data-k=min]', sh), stepsI = $('[data-k=steps]', sh), kcalI = $('[data-k=kcal]', sh);
  typeSel.value = existing?.type || 'joga';
  let manual = !!existing;
  const act = () => ACTIVITIES.find(a => a.id === typeSel.value);
  const recalc = () => {
    const a = act();
    $('[data-k=minL]', sh).hidden = !!a.steps;
    $('[data-k=stepsL]', sh).hidden = !a.steps;
    const k = activityKcal(a, { minutes: num(minI.value), steps: num(stepsI.value) }, w);
    if (k != null && !manual) kcalI.value = k;
    $('[data-k=hint]', sh).textContent = a.custom ? 'Wpisz kalorie, np. odczytane z zegarka.'
      : a.steps ? 'Szacunek: ok. 0,5 kcal na każdy kilogram masy ciała na 1000 kroków.'
      : `Przelicznik: ${f1(a.met)} MET × ${f1(w)} kg × czas. Możesz poprawić wynik, np. według zegarka.`;
  };
  const onIn = e => {
    const k = e.target.dataset.k;
    if (k === 'kcal') manual = true;
    else if (k === 'type' || k === 'min' || k === 'steps') { if (k === 'type') manual = false; recalc(); }
  };
  sh.oninput = onIn;
  sh.onchange = onIn;
  sh.onclick = safe(async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.q) {
      const q = QUICK_ACTS[+b.dataset.q];
      typeSel.value = q.id; minI.value = q.minutes; manual = false; recalc();
    }
    if (b.dataset.k === 'save') {
      const a = act(), kcal = r0(num(kcalI.value));
      if (!a.steps && !(num(minI.value) > 0)) return toast('Podaj czas w minutach', 'err');
      if (a.steps && !(num(stepsI.value) > 0)) return toast('Podaj liczbę kroków', 'err');
      if (a.custom && !kcal) return toast('Podaj spalone kalorie', 'err');
      await db.saveAct({
        id: existing?.id, date: existing?.date || S.date, type: a.id, label: a.label.replace(/ \(.*\)$/, a.custom ? '' : '$&'),
        minutes: a.steps ? null : num(minI.value), steps: a.steps ? r0(num(stepsI.value)) : null, kcal,
        note: $('[data-k=note]', sh).value.trim() || null,
      });
      closeSheet(); toast('Zapisano ✔'); app.refresh();
    }
    if (b.dataset.k === 'del') {
      if (!confirm('Usunąć tę aktywność?')) return;
      await db.deleteAct(existing.id);
      closeSheet(); toast('Usunięto'); app.refresh();
    }
  });
  recalc();
}

/* ---------- Kalendarz ---------- */
function shiftMonth(m, n) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

async function renderCalendar() {
  const m = S.calMonth || S.date.slice(0, 7);
  S.calMonth = m;
  const [y, mo] = m.split('-').map(Number);
  const nDays = new Date(y, mo, 0).getDate();
  const [E, A] = await Promise.all([
    db.entriesRange(`${m}-01`, `${m}-${pad(nDays)}`, 'date,kcal,protein'),
    db.actsRange(`${m}-01`, `${m}-${pad(nDays)}`, 'date,kcal,minutes'),
  ]);
  if (S.tab !== 'cal' || S.calMonth !== m) return;

  const day = {};
  const get = ds => (day[ds] ||= { kcal: 0, protein: 0, act: 0, min: 0, n: 0 });
  for (const e of E) { const d = get(e.date); d.kcal += +e.kcal || 0; d.protein += +e.protein || 0; d.n++; }
  for (const a of A) { const d = get(a.date); d.act += +a.kcal || 0; d.min += +a.minutes || 0; }

  const p = S.profile, t = computeTargets(p), today = todayStr();
  const offset = (new Date(y, mo - 1, 1).getDay() + 6) % 7;
  let cells = '<div class="cell empty"></div>'.repeat(offset);
  for (let i = 1; i <= nDays; i++) {
    const ds = `${m}-${pad(i)}`, d = day[ds];
    let cls = '';
    if (d?.n) { const r = d.kcal / budget(p, d.act); cls = r > 1.05 ? 'over' : r < 0.75 ? 'low' : 'ok'; }
    cells += `<button class="cell ${cls} ${ds === today ? 'today' : ''}" data-act="calDay" data-date="${ds}">
      <span class="dn">${i}</span>${d?.n ? `<span class="dk">${r0(d.kcal)}</span>` : ''}${d?.act ? '<span class="dot"></span>' : ''}</button>`;
  }
  const logged = Object.values(day).filter(d => d.n);
  const avg = k => (logged.length ? logged.reduce((s, d) => s + d[k], 0) / logged.length : 0);
  const actMin = Object.values(day).reduce((s, d) => s + d.min, 0);
  const actK = Object.values(day).reduce((s, d) => s + d.act, 0);
  const balance = logged.reduce((s, d) => s + d.kcal - (t.tdee + d.act), 0);
  const sign = balance < 0 ? '−' : '+';
  const label = cap(new Date(y, mo - 1, 1).toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' }));

  main().innerHTML = `<header class="pagehead calhead">
      <button class="iconbtn" data-act="calPrev" aria-label="Poprzedni miesiąc">‹</button><h1>${esc(label)}</h1>
      <button class="iconbtn" data-act="calNext" aria-label="Następny miesiąc">›</button></header>
    <div class="calgrid">${['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'].map(x => `<div class="wd">${x}</div>`).join('')}${cells}</div>
    <div class="legend"><span><i class="ok"></i>w normie</span><span><i class="over"></i>ponad limit</span><span><i class="low"></i>bardzo mało</span><span><i class="dotl"></i>aktywność</span></div>
    <section class="card"><h3>Podsumowanie miesiąca</h3>
      ${logged.length ? `<div class="stats">
        <div><b>${logged.length}</b><span>dni z wpisami</span></div>
        <div><b>${r0(avg('kcal'))}</b><span>śr. kcal dziennie</span></div>
        <div><b>${r0(avg('protein'))} g</b><span>śr. białko (cel ${p.protein_g} g)</span></div>
        <div><b>${r0(actMin)} min</b><span>aktywności, ${r0(actK)} kcal</span></div></div>
        <p class="small muted">Szacowany bilans z dni z wpisami: ${sign}${Math.abs(r0(balance))} kcal ≈ ${sign}${f1(Math.abs(balance / 7700))} kg.
        To tylko szacunek – najlepiej waż się raz w tygodniu o tej samej porze.</p>`
      : '<p class="muted">Brak wpisów w tym miesiącu.</p>'}
    </section>
    <p class="small muted center">Kliknij dzień, żeby zobaczyć szczegóły.</p>`;
}

/* ---------- Profil ---------- */
async function renderProfile() {
  const p = S.profile, t = computeTargets(p);
  const goal = GOALS.find(g => g.id === p.goal), life = LIFESTYLES.find(l => l.id === p.lifestyle);
  main().innerHTML = `<header class="pagehead"><h1>Profil</h1></header>
    <section class="card"><h3>Dzienne cele</h3>
      <div class="stats five">
        <div><b>${p.kcal_target}</b><span>kcal</span></div><div><b>${p.protein_g} g</b><span>białko</span></div>
        <div><b>${p.carbs_g} g</b><span>węgle</span></div><div><b>${p.fat_g} g</b><span>tłuszcz</span></div>
        <div><b>${p.fiber_g} g</b><span>błonnik</span></div></div>
      <p class="small muted">${p.targets_manual ? 'Ustawione ręcznie.' : 'Wyliczone automatycznie.'} Zapotrzebowanie bez treningów ≈ ${t.tdee} kcal${p.goal === 'cut' ? ', cel −20%' : p.goal === 'gain' ? ', cel +10%' : ''}. Aktywność dodaje do limitu połowę spalonych kalorii.</p>
      <button class="btn" data-act="editTargets">Dostosuj ręcznie</button></section>

    <section class="card"><h3>Waga</h3>
      <div class="row-input"><input id="pf-w" inputmode="decimal" value="${f1(p.weight_kg)}" aria-label="Waga w kg"><span>kg</span><button class="btn" data-act="saveWeight">Zapisz</button></div>
      <div id="w-hist" class="small muted"></div></section>

    <section class="card"><h3>Moje dane i cel</h3>
      <p>${p.sex === 'f' ? 'Kobieta' : 'Mężczyzna'}, ${p.age} lat, ${f1(p.height_cm)} cm<br>Tryb życia: ${esc(life?.label || '')}<br>Cel: <b>${esc(goal?.label || '')}</b></p>
      <button class="btn" data-act="editProfile">Zmień dane lub cel</button></section>

    <section class="card"><h3>Rozpoznawanie zdjęć (Gemini)</h3>
      <p class="small muted">Klucz zapisuje się tylko na tym urządzeniu – na telefonie i na komputerze wpisz go osobno.</p>
      <label>Klucz API<input id="pf-key" type="password" autocomplete="off" value="${esc(getKey())}" placeholder="AIza…"></label>
      <details><summary class="small">Ustawienia zaawansowane</summary>
        <label>Model<input id="pf-model" value="${esc(getModel())}" placeholder="${DEFAULT_MODEL}"></label></details>
      <button class="btn" data-act="saveGemini">Zapisz klucz</button>
      <p class="small">${getKey() ? '✅ Klucz zapisany na tym urządzeniu.' : '⚠️ Brak klucza – zdjęcia nie będą rozpoznawane.'}
        Klucz utworzysz na <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">aistudio.google.com</a>.</p></section>

    <section class="card"><h3>Konto</h3><p class="small muted">Zalogowano jako ${esc(S.session.user.email)}</p>
      <button class="btn" data-act="logout">Wyloguj</button></section>
    <p class="small muted center">Forma · wersja 1.0</p>`;

  const hist = await db.weightHistory().catch(() => []);
  const h = $('#w-hist');
  if (h && hist.length > 1) h.innerHTML = 'Ostatnie pomiary: ' + hist.map(x => `${fmtShort(x.date)}: <b>${f1(x.weight_kg)}</b>`).join(' · ');
}

function openTargets() {
  const p = S.profile;
  const F = [['kcal_target', 'kcal'], ['protein_g', 'Białko (g)'], ['carbs_g', 'Węgle (g)'], ['fat_g', 'Tłuszcz (g)'], ['fiber_g', 'Błonnik (g)']];
  const sh = openSheet(`<h2>Dostosuj cele</h2>
    <div class="grid5">${F.map(([k, l]) => `<label>${l}<input data-t="${k}" inputmode="numeric" value="${p[k]}"></label>`).join('')}</div>
    <p class="small muted">Dla porównania: 1 g białka lub węglowodanów to 4 kcal, 1 g tłuszczu to 9 kcal.</p>
    <button class="btn primary" data-k="save">Zapisz</button>
    <button class="btn" data-k="auto">Przywróć wyliczone automatycznie</button>`);
  sh.onclick = safe(async e => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    let patch;
    if (b.dataset.k === 'save') {
      patch = { targets_manual: true };
      for (const el of $$('[data-t]', sh)) patch[el.dataset.t] = r0(num(el.value));
      if (patch.kcal_target < 1000) return toast('Cel kalorii poniżej 1000 kcal jest zbyt niski', 'err');
    } else {
      patch = { ...targetsOnly(computeTargets(p)), targets_manual: false };
    }
    S.profile = await db.saveProfile({ ...profileCols(p), ...patch });
    closeSheet(); toast('Zapisano ✔'); go('profile');
  });
}

/* ---------- Akcje przycisków ---------- */
const ACT = {
  prev: () => { S.date = addDays(S.date, -1); renderDay(); },
  next: () => { S.date = addDays(S.date, 1); renderDay(); },
  today: () => { S.date = todayStr(); renderDay(); },
  addMeal: () => openAddMeal(),
  addAct: () => openActivity(),
  entry: t => openEditEntry(S.dayEntries.find(e => e.id === t.dataset.id)),
  act: t => openActivity(S.dayActs.find(a => a.id === t.dataset.id)),
  calPrev: () => { S.calMonth = shiftMonth(S.calMonth, -1); renderCalendar(); },
  calNext: () => { S.calMonth = shiftMonth(S.calMonth, 1); renderCalendar(); },
  calDay: t => { S.date = t.dataset.date; go('day'); },
  editTargets: () => openTargets(),
  editProfile: () => { S.onb = { step: 1, edit: true, p: { ...S.profile } }; setTabbar(false); renderOnboarding(); },
  saveWeight: async () => {
    const kg = r1(num($('#pf-w').value));
    if (kg < 35 || kg > 300) return toast('Podaj wagę w kg', 'err');
    const p = S.profile;
    const patch = { weight_kg: kg };
    if (!p.targets_manual) Object.assign(patch, targetsOnly(computeTargets({ ...p, weight_kg: kg })));
    S.profile = await db.saveProfile({ ...profileCols(p), ...patch });
    await db.logWeight(todayStr(), kg);
    toast(p.targets_manual ? 'Zapisano ✔' : 'Zapisano ✔ Cele przeliczone.');
    go('profile');
  },
  saveGemini: () => {
    setKey($('#pf-key').value);
    setModel($('#pf-model').value);
    toast('Zapisano ✔');
    go('profile');
  },
  logout: async () => {
    if (!confirm('Wylogować się?')) return;
    await supabase.auth.signOut();
  },
};

boot();
