// Posiłki: dodawanie (zdjęcie, kod, baza, ręcznie), edycja wpisów, moja baza, przepisy
import { S, app } from './state.js';
import { db } from './db.js';
import { safe } from './errors.js';
import { MEALS, defaultMeal, foodValues, sum, NUTR, r0, r1 } from './calc.js';
import { CATALOG } from './catalog.js';
import { analyzeMeal, resizeImage, getKey } from './gemini.js';
import { startScanner, stopScanner, lookupBarcode } from './barcode.js';
import { $, $$, esc, num, norm, toast, openSheet, closeSheet, onSheetClose, fmtLong } from './ui.js';

export const LBL = { kcal: 'kcal', protein: 'Białko', carbs: 'Węgle', fat: 'Tłuszcz', fiber: 'Błonnik' };
export const f1 = n => String(r1(n)).replace('.', ',');
export const macroLine = v => `${r0(v.kcal)} kcal · B ${f1(v.protein)} · W ${f1(v.carbs)} · T ${f1(v.fat)}`;
const unitInfo = f => (f.basis === 'g' ? 'na 100 g' : 'na 1 ' + (f.unit_label || 'porcję'));
const valsHtml = v => `<div class="vals">
  <div><b>${r0(v.kcal)}</b><span>kcal</span></div><div><b>${f1(v.protein)}</b><span>białko</span></div>
  <div><b>${f1(v.carbs)}</b><span>węgle</span></div><div><b>${f1(v.fat)}</b><span>tłuszcz</span></div>
  <div><b>${f1(v.fiber)}</b><span>błonnik</span></div></div>`;
const byFavUse = (a, b) => (b.favorite - a.favorite) || ((b.use_count || 0) - (a.use_count || 0)) || a.name.localeCompare(b.name, 'pl');
const findFood = id => S.foods.find(f => f.id === id) || CATALOG.find(f => f.id === id);
const isReal = id => id && !String(id).startsWith('cat:');
const pick5 = f => ({ kcal: +f.kcal || 0, protein: +f.protein || 0, carbs: +f.carbs || 0, fat: +f.fat || 0, fiber: +f.fiber || 0 });

function upsertLocal(food) {
  const i = S.foods.findIndex(f => f.id === food.id);
  if (i >= 0) S.foods[i] = food; else S.foods.push(food);
}

// Zamienia pozycję (wartości dla podanej ilości) na produkt do bazy
function foodFromItem(it) {
  const a = it.amount > 0 ? it.amount : 1;
  const g = it.unit === 'g';
  const k = g ? 100 / a : 1 / a;
  const o = { name: it.name, basis: g ? 'g' : 'szt', unit_label: g ? null : (it.unit_label || 'szt.'), unit_grams: g ? r0(a) : null };
  for (const n of NUTR) o[n] = r1((+it[n] || 0) * k);
  o.kcal = r0(o.kcal);
  return o;
}

async function saveEntries(items, meal, source) {
  const rows = [];
  for (const it of items) {
    let foodId = isReal(it.food_id) ? it.food_id : null;
    if (it.saveToBase && !foodId) {
      const src = it._food ? { ...it._food, name: it.name } : foodFromItem(it);
      const f = await db.saveFood({ ...src, id: null });
      upsertLocal(f);
      foodId = f.id;
    }
    rows.push({
      date: S.date, meal, name: it.name.trim(), amount: r1(it.amount), amount_unit: it.unit === 'g' ? 'g' : 'szt',
      kcal: r0(it.kcal), protein: r1(it.protein), carbs: r1(it.carbs), fat: r1(it.fat), fiber: r1(it.fiber),
      food_id: foodId, source,
    });
  }
  await db.addEntries(rows);
  for (const id of new Set(rows.map(r => r.food_id).filter(Boolean))) {
    const f = S.foods.find(x => x.id === id);
    if (f) {
      f.use_count = (f.use_count || 0) + 1;
      f.last_used_at = new Date().toISOString();
      db.saveFood(f).catch(() => {});
    }
  }
  closeSheet();
  toast(rows.length > 1 ? `Dodano ${rows.length} pozycje ✔` : 'Dodano ✔');
  app.refresh();
}

/* ---------- Okno "Dodaj posiłek" ---------- */
export function openAddMeal() {
  const sh = openSheet(`<h2>Dodaj posiłek</h2>
    <p class="muted small">${esc(fmtLong(S.date))}</p>
    <label class="inline">Posiłek <select id="am-meal">${MEALS.map(m => `<option value="${m.id}" ${m.id === defaultMeal() ? 'selected' : ''}>${m.label}</option>`).join('')}</select></label>
    <div class="tabs" id="am-tabs">
      <button data-tab="photo">📷 Zdjęcie</button><button data-tab="barcode">▦ Kod</button>
      <button data-tab="base">⭐ Baza</button><button data-tab="manual">✏️ Ręcznie</button>
    </div>
    <div id="am-body"></div>`);
  const ctx = { meal: () => $('#am-meal', sh).value };
  const panels = { photo: panelPhoto, barcode: panelBarcode, base: panelBase, manual: panelManual };
  const show = k => {
    stopScanner();
    $$('#am-tabs button', sh).forEach(b => b.classList.toggle('active', b.dataset.tab === k));
    const body = $('#am-body', sh);
    body.onclick = null; body.oninput = null;
    body.innerHTML = '';
    panels[k](body, ctx);
  };
  $('#am-tabs', sh).onclick = e => { const b = e.target.closest('button'); if (b) show(b.dataset.tab); };
  onSheetClose(() => stopScanner());
  show(getKey() ? 'photo' : (S.foods.length ? 'base' : 'photo'));
}

/* --- Zdjęcie --- */
function panelPhoto(body, ctx) {
  if (!getKey()) {
    body.innerHTML = `<div class="card info"><p>Żeby rozpoznawać zdjęcia, wpisz darmowy klucz Gemini w zakładce <b>Profil</b>.</p>
      <button class="btn" data-k="prof">Przejdź do Profilu</button></div>`;
    body.onclick = e => { if (e.target.closest('[data-k=prof]')) { closeSheet(); app.go('profile'); } };
    return;
  }
  body.innerHTML = `<label class="btn big photo-btn">📷 Zrób lub wybierz zdjęcie<input type="file" accept="image/*" data-k="file" hidden></label>
    <img data-k="prev" class="preview" hidden alt="Zdjęcie posiłku">
    <label>Opis (opcjonalnie)<textarea data-k="text" rows="2" placeholder="np. 2 naleśniki z twarogiem, kawa z mlekiem 2%"></textarea></label>
    <button class="btn primary" data-k="go" disabled>✨ Rozpoznaj</button>
    <div data-k="res"></div>`;
  let blob = null;
  $('[data-k=file]', body).onchange = safe(async e => {
    const f = e.target.files[0];
    if (!f) return;
    blob = await resizeImage(f);
    const img = $('[data-k=prev]', body);
    img.src = URL.createObjectURL(blob);
    img.hidden = false;
    $('[data-k=go]', body).disabled = false;
  });
  $('[data-k=go]', body).onclick = safe(async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Rozpoznaję… (kilka sekund)';
    try {
      const r = await analyzeMeal({ imageBlob: blob, text: $('[data-k=text]', body).value.trim(), foods: S.foods });
      itemsEditor($('[data-k=res]', body), normalizeAi(r), ctx, 'photo', r.note);
    } finally {
      btn.disabled = false;
      btn.textContent = '✨ Rozpoznaj ponownie';
    }
  });
}

function normalizeAi(r) {
  return (r.items || []).map(x => {
    const it = {
      name: x.name || 'Produkt', amount: x.amount > 0 ? r1(x.amount) : 1, unit: x.unit === 'szt' ? 'szt' : 'g',
      kcal: r0(x.kcal), protein: r1(x.protein), carbs: r1(x.carbs), fat: r1(x.fat), fiber: r1(x.fiber),
    };
    const food = x.matched_food_id && S.foods.find(f => f.id === x.matched_food_id);
    if (food) {
      Object.assign(it, { name: food.name, food_id: food.id, unit: food.basis === 'g' ? 'g' : 'szt', unit_label: food.unit_label }, foodValues(food, it.amount));
    }
    return it;
  });
}

// Lista rozpoznanych pozycji do poprawienia przed zapisem
function itemsEditor(container, items, ctx, source, note) {
  const box = document.createElement('div');
  container.replaceChildren(box);
  for (const it of items) {
    it.include = true;
    it.per = {};
    for (const n of NUTR) it.per[n] = (+it[n] || 0) / (it.amount || 1);
  }
  const fld = (i, f) => `<label>${LBL[f]}<input data-i="${i}" data-f="${f}" inputmode="decimal" value="${items[i][f]}"></label>`;
  box.innerHTML = `${note ? `<p class="note">ℹ️ ${esc(note)}</p>` : ''}
    ${items.length ? '' : '<p class="muted">Nic nie rozpoznano. Spróbuj innego zdjęcia albo dopisz opis.</p>'}
    ${items.map((it, i) => `<div class="item">
      <div class="item-top">
        <input type="checkbox" data-i="${i}" data-f="include" checked aria-label="Uwzględnij">
        <input class="iname" data-i="${i}" data-f="name" value="${esc(it.name)}">
        ${it.food_id ? '<span class="badge">z bazy</span>' : ''}
      </div>
      <div class="grid6">
        <label>Ilość (${it.unit === 'g' ? 'g' : 'szt.'})<input data-i="${i}" data-f="amount" inputmode="decimal" value="${it.amount}"></label>
        ${NUTR.map(n => fld(i, n)).join('')}
      </div>
      ${it.food_id ? '' : `<label class="check"><input type="checkbox" data-i="${i}" data-f="saveToBase"> Zapisz w mojej bazie</label>`}
    </div>`).join('')}
    ${items.length ? `<div class="totals" data-k="tot"></div>
      <p class="muted small">To szacunek – popraw ilość, jeśli wiesz lepiej. Wartości przeliczą się same.</p>
      <button class="btn primary" data-k="save">Dodaj do dziennika</button>` : ''}`;
  const tot = () => { const t = $('[data-k=tot]', box); if (t) t.innerHTML = '<b>Razem:</b> ' + macroLine(sum(items.filter(i => i.include))); };
  const onEdit = e => {
    const el = e.target;
    if (el.dataset?.i == null) return;
    const it = items[+el.dataset.i], f = el.dataset.f;
    if (f === 'include' || f === 'saveToBase') {
      it[f] = el.checked;
      if (f === 'include') el.closest('.item').classList.toggle('off', !el.checked);
    } else if (f === 'name') {
      it.name = el.value;
    } else if (f === 'amount') {
      const a = num(el.value);
      if (a > 0) {
        it.amount = a;
        for (const n of NUTR) {
          it[n] = n === 'kcal' ? r0(it.per[n] * a) : r1(it.per[n] * a);
          const inp = $(`[data-i="${el.dataset.i}"][data-f="${n}"]`, box);
          if (inp) inp.value = it[n];
        }
      }
    } else {
      it[f] = num(el.value);
      it.per[f] = it[f] / (it.amount || 1);
    }
    tot();
  };
  box.oninput = onEdit;
  box.onchange = onEdit;
  const saveBtn = $('[data-k=save]', box);
  if (saveBtn) saveBtn.onclick = safe(async () => {
    const chosen = items.filter(i => i.include && i.name.trim());
    if (!chosen.length) return toast('Zaznacz co najmniej jedną pozycję', 'err');
    saveBtn.disabled = true;
    try { await saveEntries(chosen, ctx.meal(), source); } finally { saveBtn.disabled = false; }
  });
  tot();
}

/* --- Kod kreskowy --- */
function panelBarcode(body, ctx) {
  body.innerHTML = `<div id="bc-cam" class="scanner"></div>
    <button class="btn big" data-k="start">📷 Włącz skaner</button>
    <div class="row-input"><input data-k="code" inputmode="numeric" placeholder="…albo wpisz numer spod kodu"><button class="btn" data-k="find">Szukaj</button></div>
    <div data-k="res"></div>`;
  const res = $('[data-k=res]', body);
  const found = safe(async raw => {
    const code = String(raw).replace(/\D/g, '');
    if (!code) return toast('Wpisz numer kodu', 'err');
    $('[data-k=code]', body).value = code;
    const own = S.foods.find(f => f.barcode === code);
    if (own) return amountPicker(res, own, ctx, 'barcode');
    res.innerHTML = '<p class="muted">Szukam w bazie Open Food Facts…</p>';
    const p = await lookupBarcode(code);
    if (!p || !p.hasData) return labelForm(res, code, p?.name || '', ctx);
    amountPicker(res, { id: null, name: p.name, basis: 'g', unit_grams: p.serving, kcal: p.kcal, protein: p.protein, carbs: p.carbs, fat: p.fat, fiber: p.fiber, barcode: code }, ctx, 'barcode', { saveDefault: true });
  });
  body.onclick = safe(async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.k === 'start') {
      b.hidden = true;
      try {
        await startScanner('bc-cam', found);
      } catch (err) {
        b.hidden = false;
        throw new Error('Nie udało się włączyć aparatu. Pozwól przeglądarce na dostęp do aparatu albo wpisz numer ręcznie.');
      }
    }
    if (b.dataset.k === 'find') { await stopScanner(); found($('[data-k=code]', body).value); }
  });
}

function labelForm(c, code, name, ctx) {
  c.innerHTML = `<div class="card"><p>Nie znalazłam wartości odżywczych tego produktu. Przepisz je z etykiety (<b>na 100 g</b>) – zapiszę produkt w Twojej bazie i następnym razem kod zadziała od razu.</p>
    <label>Nazwa<input data-k="name" value="${esc(name)}" placeholder="np. Jogurt naturalny Piątnica"></label>
    <div class="grid5">${NUTR.map(n => `<label>${LBL[n]}<input data-n="${n}" inputmode="decimal"></label>`).join('')}</div>
    <button class="btn primary" data-k="ok">Zapisz produkt</button></div>`;
  c.onclick = safe(async e => {
    if (!e.target.closest('[data-k=ok]')) return;
    const f = { name: $('[data-k=name]', c).value.trim() || `Produkt ${code}`, basis: 'g', barcode: code };
    for (const el of $$('[data-n]', c)) f[el.dataset.n] = num(el.value);
    if (!f.kcal) return toast('Podaj przynajmniej kalorie', 'err');
    const saved = await db.saveFood(f);
    upsertLocal(saved);
    c.onclick = null;
    amountPicker(c, saved, ctx, 'barcode');
  });
}

/* --- Wybór ilości dla produktu --- */
function amountPicker(c, food, ctx, source, opts = {}) {
  const isG = food.basis === 'g';
  const unitTxt = isG ? 'g' : (food.unit_label || 'szt.');
  const canSave = !isReal(food.id);
  const ug = food.unit_grams;
  c.innerHTML = `<div class="card picker">
    ${opts.back ? '<button class="link" data-k="back">← wróć do listy</button>' : ''}
    <div class="pk-name">${esc(food.name)}</div>
    <div class="muted small">${unitInfo(food)}: ${macroLine(food)}</div>
    <div class="stepper"><button data-k="minus" aria-label="Mniej">−</button><input data-k="amt" inputmode="decimal" value="${isG ? (ug || 100) : 1}"><span>${esc(unitTxt)}</span><button data-k="plus" aria-label="Więcej">+</button></div>
    <div class="chips">${isG
      ? (ug ? [1, 2].map(m => `<button class="chip" data-g="${ug * m}">${m}× porcja (${ug * m} g)</button>`).join('') : '') + [50, 100, 150, 200].map(g => `<button class="chip" data-g="${g}">${g} g</button>`).join('')
      : [0.5, 1, 2, 3].map(n => `<button class="chip" data-g="${n}">${f1(n)}</button>`).join('')}</div>
    <div data-k="vals"></div>
    ${canSave ? `<label class="check"><input type="checkbox" data-k="save" ${opts.saveDefault ? 'checked' : ''}> Zapisz w mojej bazie</label>` : ''}
    <button class="btn primary" data-k="add">Dodaj</button></div>`;
  const inp = $('[data-k=amt]', c);
  const upd = () => { $('[data-k=vals]', c).innerHTML = valsHtml(foodValues(food, num(inp.value))); };
  c.oninput = upd;
  c.onclick = safe(async e => {
    const b = e.target.closest('button');
    if (!b) return;
    const step = isG ? 10 : 0.5;
    if (b.dataset.g) { inp.value = b.dataset.g; upd(); }
    else if (b.dataset.k === 'minus') { inp.value = Math.max(step, r1(num(inp.value) - step)); upd(); }
    else if (b.dataset.k === 'plus') { inp.value = r1(num(inp.value) + step); upd(); }
    else if (b.dataset.k === 'back') opts.back();
    else if (b.dataset.k === 'add') {
      const amount = num(inp.value);
      if (!(amount > 0)) return toast('Podaj ilość', 'err');
      b.disabled = true;
      try {
        await saveEntries([{
          name: food.name, amount, unit: isG ? 'g' : 'szt', unit_label: food.unit_label, ...foodValues(food, amount),
          food_id: food.id, saveToBase: $('[data-k=save]', c)?.checked, _food: food,
        }], ctx.meal(), source);
      } finally { b.disabled = false; }
    }
  });
  upd();
}

/* --- Moja baza (w oknie dodawania) --- */
function panelBase(body, ctx) {
  body.innerHTML = `<input type="search" data-k="q" placeholder="Szukaj, np. naleśnik, twaróg, banan…">
    <div class="list" data-k="list"></div><div data-k="pick"></div>`;
  const list = $('[data-k=list]', body), pickEl = $('[data-k=pick]', body), q = $('[data-k=q]', body);
  const row = f => `<button class="row" data-fid="${f.id}"><div><div class="r-name">${f.favorite ? '★ ' : ''}${esc(f.name)}</div>
    <div class="r-sub">${unitInfo(f)} · ${macroLine(f)}</div></div><span class="chev">›</span></button>`;
  const draw = () => {
    pickEl.innerHTML = '';
    q.hidden = false;
    const s = norm(q.value);
    const own = S.foods.filter(f => !s || norm(f.name).includes(s)).sort(byFavUse);
    const cat = s ? CATALOG.filter(f => norm(f.name).includes(s)) : [];
    list.innerHTML =
      (own.length ? `<div class="sec">Moje (${own.length})</div>` + own.slice(0, 60).map(row).join('')
        : (s ? '' : '<div class="empty">Twoja baza jest jeszcze pusta. Zaznaczaj „Zapisz w mojej bazie” przy dodawaniu posiłków albo dodaj je w zakładce Baza.</div>')) +
      (cat.length ? '<div class="sec">Produkty podstawowe (na 100 g)</div>' + cat.slice(0, 30).map(row).join('') : '') +
      (s && !own.length && !cat.length ? '<p class="muted">Nic nie znaleziono – użyj zakładki „Ręcznie”.</p>' : '') +
      (!s ? '<p class="muted small">Wpisz nazwę, żeby przeszukać też produkty podstawowe (mąka, jajka, twaróg…).</p>' : '');
  };
  q.oninput = draw;
  list.onclick = e => {
    const b = e.target.closest('[data-fid]');
    if (!b) return;
    list.innerHTML = '';
    q.hidden = true;
    amountPicker(pickEl, findFood(b.dataset.fid), ctx, 'base', { back: draw });
  };
  draw();
}

/* --- Ręcznie --- */
function panelManual(body, ctx) {
  body.innerHTML = `<label>Co zjadłaś lub wypiłaś?<input data-k="name" placeholder="np. zupa pomidorowa z ryżem, 1 talerz"></label>
    <button class="btn" data-k="ai">✨ Oszacuj z opisu (Gemini)</button>
    <div data-k="aires"></div>
    <div class="sep"><span>albo wpisz wartości sama</span></div>
    <div class="grid2"><label>Ilość<input data-k="amount" inputmode="decimal" value="1"></label>
      <label>Jednostka<select data-k="unit"><option value="szt">porcja / sztuka</option><option value="g">gramy</option></select></label></div>
    <div class="grid5">${NUTR.map(n => `<label>${LBL[n]}<input data-n="${n}" inputmode="decimal"></label>`).join('')}</div>
    <p class="muted small">Wpisz wartości dla całej podanej ilości.</p>
    <label class="check"><input type="checkbox" data-k="tobase"> Zapisz w mojej bazie</label>
    <button class="btn primary" data-k="add">Dodaj</button>`;
  body.onclick = safe(async e => {
    const b = e.target.closest('button');
    if (!b) return;
    const name = $('[data-k=name]', body).value.trim();
    if (b.dataset.k === 'ai') {
      if (!name) return toast('Najpierw opisz posiłek', 'err');
      if (!getKey()) return toast('Dodaj klucz Gemini w zakładce Profil', 'err');
      b.disabled = true;
      b.textContent = 'Szacuję…';
      try {
        const r = await analyzeMeal({ text: name, foods: S.foods });
        itemsEditor($('[data-k=aires]', body), normalizeAi(r), ctx, 'ai', r.note);
      } finally {
        b.disabled = false;
        b.textContent = '✨ Oszacuj ponownie';
      }
    }
    if (b.dataset.k === 'add') {
      if (!name) return toast('Podaj nazwę', 'err');
      const it = { name, amount: num($('[data-k=amount]', body).value) || 1, unit: $('[data-k=unit]', body).value, saveToBase: $('[data-k=tobase]', body).checked };
      for (const el of $$('[data-n]', body)) it[el.dataset.n] = num(el.value);
      if (!it.kcal) return toast('Podaj kalorie', 'err');
      b.disabled = true;
      try { await saveEntries([it], ctx.meal(), 'manual'); } finally { b.disabled = false; }
    }
  });
}

/* ---------- Edycja wpisu w dzienniku ---------- */
export function openEditEntry(en) {
  if (!en) return;
  const a0 = +en.amount || 1;
  const per = {};
  for (const n of NUTR) per[n] = (+en[n] || 0) / a0;
  const sh = openSheet(`<h2>${esc(en.name)}</h2>
    <label>Ilość (${en.amount_unit === 'g' ? 'g' : 'sztuki / porcje'})<input data-k="amt" inputmode="decimal" value="${f1(a0)}"></label>
    <label>Posiłek<select data-k="meal">${MEALS.map(m => `<option value="${m.id}" ${m.id === en.meal ? 'selected' : ''}>${m.label}</option>`).join('')}</select></label>
    <div data-k="vals"></div>
    <button class="btn primary" data-k="save">Zapisz zmiany</button>
    ${en.food_id ? '' : '<button class="btn" data-k="tobase">⭐ Zapisz w mojej bazie</button>'}
    <button class="btn danger" data-k="del">Usuń wpis</button>`);
  const cur = () => {
    const a = num($('[data-k=amt]', sh).value);
    const v = {};
    for (const n of NUTR) v[n] = n === 'kcal' ? r0(per[n] * a) : r1(per[n] * a);
    return { a, v };
  };
  const upd = () => { $('[data-k=vals]', sh).innerHTML = valsHtml(cur().v); };
  sh.oninput = upd;
  sh.onclick = safe(async e => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    const { a, v } = cur();
    if (b.dataset.k === 'save') {
      if (!(a > 0)) return toast('Podaj ilość', 'err');
      await db.updateEntry(en.id, { amount: a, meal: $('[data-k=meal]', sh).value, ...v });
      closeSheet(); toast('Zapisano ✔'); app.refresh();
    }
    if (b.dataset.k === 'tobase') {
      const f = await db.saveFood(foodFromItem({ name: en.name, amount: a || 1, unit: en.amount_unit === 'g' ? 'g' : 'szt', ...v }));
      upsertLocal(f);
      await db.updateEntry(en.id, { food_id: f.id });
      b.remove();
      toast('Zapisano w Twojej bazie ⭐');
    }
    if (b.dataset.k === 'del') {
      if (!confirm(`Usunąć „${en.name}” z dziennika?`)) return;
      await db.deleteEntry(en.id);
      closeSheet(); toast('Usunięto'); app.refresh();
    }
  });
  upd();
}

/* ---------- Zakładka "Baza" ---------- */
export function renderBase(el) {
  el.innerHTML = `<header class="pagehead"><h1>Moja baza</h1><p class="muted">Powtarzalne posiłki i produkty – dodajesz je jednym kliknięciem.</p></header>
    <div class="btnrow"><button class="btn" data-k="new">+ Produkt / posiłek</button><button class="btn" data-k="recipe">+ Przepis ze składników</button></div>
    <input type="search" data-k="q" placeholder="Szukaj…">
    <div class="list" data-k="list"></div>`;
  const draw = () => {
    const s = norm($('[data-k=q]', el).value);
    const list = S.foods.filter(f => !s || norm(f.name).includes(s)).sort(byFavUse);
    $('[data-k=list]', el).innerHTML = list.length
      ? list.map(f => `<div class="frow">
          <button class="star ${f.favorite ? 'on' : ''}" data-fav="${f.id}" aria-label="Ulubione">${f.favorite ? '★' : '☆'}</button>
          <button class="row" data-edit="${f.id}"><div><div class="r-name">${esc(f.name)}${f.recipe ? ' <span class="badge">przepis</span>' : ''}</div>
          <div class="r-sub">${unitInfo(f)} · ${macroLine(f)}</div></div><span class="chev">›</span></button></div>`).join('')
      : `<div class="empty">${s ? 'Nic nie znaleziono.' : 'Baza jest pusta.<br>Dodaj np. „Naleśnik z twarogiem” – potem wpiszesz go do dziennika jednym kliknięciem.'}</div>`;
  };
  $('[data-k=q]', el).oninput = draw;
  el.onclick = safe(async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.k === 'new') openFoodEditor(null, draw);
    if (b.dataset.k === 'recipe') openRecipeEditor(null, draw);
    if (b.dataset.edit) {
      const f = S.foods.find(x => x.id === b.dataset.edit);
      f.recipe ? openRecipeEditor(f, draw) : openFoodEditor(f, draw);
    }
    if (b.dataset.fav) {
      const f = S.foods.find(x => x.id === b.dataset.fav);
      f.favorite = !f.favorite;
      draw();
      await db.saveFood(f);
    }
  });
  draw();
}

export function openFoodEditor(food, onDone) {
  const f = food ? { ...food } : { name: '', basis: 'szt', unit_label: 'porcja', favorite: false };
  const sh = openSheet(`<h2>${food ? 'Edytuj' : 'Nowy'} produkt / posiłek</h2>
    <label>Nazwa<input data-k="name" value="${esc(f.name)}" placeholder="np. Naleśnik z twarogiem"></label>
    <div class="field"><span>Wartości podaję na</span><div class="seg"><button data-b="szt">1 sztukę / porcję</button><button data-b="g">100 g</button></div></div>
    <label data-show="szt">Nazwa sztuki / porcji<input data-k="unit_label" value="${esc(f.unit_label || '')}" placeholder="np. naleśnik, porcja, kromka"></label>
    <label data-show="g">Typowa porcja w gramach (opcjonalnie)<input data-k="unit_grams" inputmode="decimal" value="${f.unit_grams ?? ''}"></label>
    <div class="grid5">${NUTR.map(n => `<label>${LBL[n]}<input data-n="${n}" inputmode="decimal" value="${f[n] ?? ''}"></label>`).join('')}</div>
    <label>Kod kreskowy (opcjonalnie)<input data-k="barcode" inputmode="numeric" value="${esc(f.barcode || '')}"></label>
    <label class="check"><input type="checkbox" data-k="favorite" ${f.favorite ? 'checked' : ''}> Ulubione (na górze listy)</label>
    <button class="btn primary" data-k="save">Zapisz</button>
    ${food ? '<button class="btn danger" data-k="del">Usuń z bazy</button>' : ''}`);
  const setBasis = b => {
    f.basis = b;
    $$('[data-b]', sh).forEach(x => x.classList.toggle('active', x.dataset.b === b));
    $$('[data-show]', sh).forEach(x => (x.hidden = x.dataset.show !== b));
  };
  setBasis(f.basis);
  sh.onclick = safe(async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.b) setBasis(b.dataset.b);
    if (b.dataset.k === 'save') {
      const name = $('[data-k=name]', sh).value.trim();
      if (!name) return toast('Podaj nazwę', 'err');
      const row = {
        ...f, name,
        unit_label: f.basis === 'szt' ? ($('[data-k=unit_label]', sh).value.trim() || 'porcja') : null,
        unit_grams: f.basis === 'g' ? (num($('[data-k=unit_grams]', sh).value) || null) : null,
        barcode: $('[data-k=barcode]', sh).value.replace(/\D/g, '') || null,
        favorite: $('[data-k=favorite]', sh).checked,
      };
      for (const el of $$('[data-n]', sh)) row[el.dataset.n] = num(el.value);
      const saved = await db.saveFood(row);
      upsertLocal(saved);
      closeSheet(); toast('Zapisano ✔'); onDone?.(saved);
    }
    if (b.dataset.k === 'del') {
      if (!confirm(`Usunąć „${f.name}” z bazy? Wpisy w dzienniku zostaną.`)) return;
      await db.deleteFood(f.id);
      S.foods = S.foods.filter(x => x.id !== f.id);
      closeSheet(); toast('Usunięto'); onDone?.();
    }
  });
}

export function openRecipeEditor(food, onDone) {
  const R = food?.recipe ? JSON.parse(JSON.stringify(food.recipe)) : { portions: 1, ingredients: [] };
  const sh = openSheet(`<h2>${food ? 'Edytuj przepis' : 'Nowy przepis'}</h2>
    <p class="muted small">Wpisz składniki całego przepisu i ile wychodzi sztuk – policzę wartości na 1 sztukę.</p>
    <label>Nazwa<input data-k="name" value="${esc(food?.name || '')}" placeholder="np. Naleśnik z twarogiem"></label>
    <div class="grid2"><label>Ile wychodzi sztuk / porcji<input data-k="portions" inputmode="decimal" value="${f1(R.portions)}"></label>
      <label>Nazwa sztuki<input data-k="unit" value="${esc(food?.unit_label || 'porcja')}" placeholder="np. naleśnik"></label></div>
    <h3>Składniki</h3>
    <div data-k="ings"></div>
    <input type="search" data-k="q" placeholder="+ Dodaj składnik – wpisz np. mąka, jajko, twaróg">
    <div class="list" data-k="res"></div>
    <button class="link" data-k="custom">+ Składnik spoza listy (wartości z etykiety)</button>
    <div data-k="cform"></div>
    <div class="card sumcard" data-k="sum"></div>
    <button class="btn primary" data-k="save">Zapisz przepis</button>
    ${food ? '<button class="btn danger" data-k="del">Usuń z bazy</button>' : ''}`);
  const portions = () => Math.max(0.5, num($('[data-k=portions]', sh).value) || 1);
  const ingVals = g => foodValues({ basis: 'g', ...g.per100 }, g.grams);
  const drawSum = () => {
    const tot = sum(R.ingredients.map(ingVals));
    const p = portions();
    const per = {};
    for (const n of NUTR) per[n] = n === 'kcal' ? r0(tot[n] / p) : r1(tot[n] / p);
    $('[data-k=sum]', sh).innerHTML = `<div class="small muted">Cały przepis: ${macroLine(tot)}</div>
      <div><b>Na 1 ${esc($('[data-k=unit]', sh).value || 'porcję')}:</b> ${macroLine(per)}</div>`;
    return per;
  };
  const drawIngs = () => {
    $('[data-k=ings]', sh).innerHTML = R.ingredients.length
      ? R.ingredients.map((g, i) => `<div class="ing"><span class="ing-name">${esc(g.name)}</span>
          <input data-gi="${i}" inputmode="decimal" value="${f1(g.grams)}" aria-label="gramy"><span>g</span>
          <button class="x" data-rm="${i}" aria-label="Usuń składnik">✕</button></div>`).join('')
      : '<p class="muted small">Brak składników.</p>';
    drawSum();
  };
  const drawRes = () => {
    const s = norm($('[data-k=q]', sh).value);
    const res = $('[data-k=res]', sh);
    if (!s) { res.innerHTML = ''; return; }
    const pool = [...S.foods.filter(f => f.basis === 'g'), ...CATALOG].filter(f => norm(f.name).includes(s)).slice(0, 12);
    res.innerHTML = pool.map(f => `<button class="row" data-add="${f.id}"><div><div class="r-name">${esc(f.name)}</div>
      <div class="r-sub">na 100 g · ${macroLine(f)}</div></div><span class="chev">+</span></button>`).join('')
      || '<p class="muted small">Brak na liście – dodaj „składnik spoza listy”.</p>';
  };
  sh.oninput = e => {
    const t = e.target;
    if (t.dataset.gi != null) { R.ingredients[+t.dataset.gi].grams = num(t.value); drawSum(); }
    else if (t.dataset.k === 'q') drawRes();
    else drawSum();
  };
  sh.onclick = safe(async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.add) {
      const f = findFood(b.dataset.add);
      R.ingredients.push({ name: f.name, grams: f.unit_grams || 100, per100: pick5(f) });
      $('[data-k=q]', sh).value = '';
      drawRes(); drawIngs();
    }
    if (b.dataset.rm) { R.ingredients.splice(+b.dataset.rm, 1); drawIngs(); }
    if (b.dataset.k === 'custom') {
      $('[data-k=cform]', sh).innerHTML = `<div class="card">
        <div class="grid2"><label>Nazwa<input data-c="name"></label><label>Ile gramów<input data-c="grams" inputmode="decimal" value="100"></label></div>
        <p class="small muted">Wartości na 100 g:</p>
        <div class="grid5">${NUTR.map(n => `<label>${LBL[n]}<input data-c="${n}" inputmode="decimal"></label>`).join('')}</div>
        <button class="btn" data-k="addc">Dodaj składnik</button></div>`;
    }
    if (b.dataset.k === 'addc') {
      const c = k => $(`[data-c=${k}]`, sh).value;
      if (!c('name').trim()) return toast('Podaj nazwę składnika', 'err');
      const per100 = {};
      for (const n of NUTR) per100[n] = num(c(n));
      R.ingredients.push({ name: c('name').trim(), grams: num(c('grams')) || 100, per100 });
      $('[data-k=cform]', sh).innerHTML = '';
      drawIngs();
    }
    if (b.dataset.k === 'save') {
      const name = $('[data-k=name]', sh).value.trim();
      if (!name) return toast('Podaj nazwę przepisu', 'err');
      if (!R.ingredients.length) return toast('Dodaj co najmniej jeden składnik', 'err');
      const per = drawSum();
      R.portions = portions();
      const saved = await db.saveFood({
        ...(food || {}), name, basis: 'szt', unit_label: $('[data-k=unit]', sh).value.trim() || 'porcja', unit_grams: null,
        ...per, recipe: R,
      });
      upsertLocal(saved);
      closeSheet(); toast('Przepis zapisany ✔'); onDone?.(saved);
    }
    if (b.dataset.k === 'del') {
      if (!confirm(`Usunąć „${food.name}” z bazy?`)) return;
      await db.deleteFood(food.id);
      S.foods = S.foods.filter(x => x.id !== food.id);
      closeSheet(); toast('Usunięto'); onDone?.();
    }
  });
  drawIngs();
}
