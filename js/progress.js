// Postępy: plan (start -> cel), prognoza terminu, cotygodniowa ocena, wykres wagi
import { db } from './db.js';
import { S } from './state.js';
import { GOALS, sum, budget, r0, r1 } from './calc.js';
import { $, esc, num, todayStr, addDays, parseDate, fmtShort } from './ui.js';

const f1 = n => r1(n).toLocaleString('pl-PL', { maximumFractionDigits: 1 });
const sgn = n => (n > 0 ? '+' : n < 0 ? '−' : '') + f1(Math.abs(n));
export const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 864e5);
const fmtDate = s => parseDate(s).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });

// Bezpieczne tempo (kg na tydzień). Środek zakresu służy do prognozy.
export const PACE = {
  cut: { min: 0.3, max: 0.5, mid: 0.4 },
  gain: { min: 0.1, max: 0.3, mid: 0.2 },
};

// Zdrowy zakres wagi dla wzrostu (BMI 18,5–24,9)
export const healthyRange = h => [r1(18.5 * (h / 100) ** 2), r1(24.9 * (h / 100) ** 2)];

// Prognoza: kiedy osiągniesz cel przy bezpiecznym tempie
export function forecast(p, fromDate, fromWeight) {
  const pace = PACE[p.goal];
  if (!pace || !p.target_weight_kg) return null;
  const left = Math.abs(fromWeight - p.target_weight_kg);
  if ((p.goal === 'cut' && fromWeight <= p.target_weight_kg) || (p.goal === 'gain' && fromWeight >= p.target_weight_kg)) return { done: true };
  const wFast = left / pace.max, wSlow = left / pace.min;
  return {
    left, weeks: [Math.ceil(wFast), Math.ceil(wSlow)],
    early: addDays(fromDate, Math.ceil(wFast * 7)), late: addDays(fromDate, Math.ceil(wSlow * 7)),
  };
}

export function forecastText(p, fromDate, fromWeight) {
  const f = forecast(p, fromDate, fromWeight);
  if (!f) return '';
  if (f.done) return 'Cel już osiągnięty 🎉';
  const pace = PACE[p.goal];
  return `Przy bezpiecznym tempie (${f1(pace.min)}–${f1(pace.max)} kg na tydzień) cel osiągniesz za ok. <b>${f.weeks[0]}–${f.weeks[1]} tygodni</b>, czyli między <b>${fmtDate(f.early)}</b> a <b>${fmtDate(f.late)}</b>.`;
}

/* ---------- Ocena: porównanie dwóch ważeń ---------- */
function periodStats(entries, acts, p, from, to) {
  const E = entries.filter(e => e.date > from && e.date <= to), A = acts.filter(a => a.date > from && a.date <= to);
  const byDay = {};
  for (const e of E) (byDay[e.date] ||= []).push(e);
  const days = Object.keys(byDay);
  const actByDay = {};
  for (const a of A) actByDay[a.date] = (actByDay[a.date] || 0) + (+a.kcal || 0);
  const n = days.length;
  const tot = days.map(d => sum(byDay[d]));
  return {
    n, span: daysBetween(from, to),
    kcal: n ? tot.reduce((s, t) => s + t.kcal, 0) / n : 0,
    protein: n ? tot.reduce((s, t) => s + t.protein, 0) / n : 0,
    budget: n ? days.reduce((s, d) => s + budget(p, actByDay[d]), 0) / n : 0,
    actMin: A.reduce((s, a) => s + (+a.minutes || 0), 0),
  };
}

export function assess(p, weights, entries, acts) {
  const msgs = [];
  const add = (lvl, text) => msgs.push({ lvl, text });
  if (!weights.length) return [{ lvl: 'info', text: 'Brak pomiarów wagi. Zważ się i zapisz wynik poniżej.' }];
  const last = weights[weights.length - 1];
  const prev = [...weights].reverse().find(w => daysBetween(w.date, last.date) >= 5);
  const target = p.target_weight_kg;

  if (target && ((p.goal === 'cut' && last.weight_kg <= target) || (p.goal === 'gain' && last.weight_kg >= target))) {
    add('ok', `🎉 Cel osiągnięty: ${f1(last.weight_kg)} kg! Teraz warto przejść na „Utrzymanie wagi” (Profil → Zmień dane lub cel), żeby utrwalić efekt.`);
    return msgs;
  }
  if (!prev) {
    const next = addDays(weights[0].date, 7);
    add('info', `Pierwsza ocena będzie po tygodniu od pierwszego ważenia – zważ się ok. ${fmtShort(next)}.`);
    return msgs;
  }

  const days = daysBetween(prev.date, last.date);
  const rate = ((last.weight_kg - prev.weight_kg) / days) * 7; // kg/tydzień, ujemne = spadek
  const st = periodStats(entries, acts, p, prev.date, last.date);
  const over = st.n && st.kcal > st.budget * 1.05;
  const prev3 = [...weights].reverse().find(w => daysBetween(w.date, last.date) >= 19);
  const rate3 = prev3 ? ((last.weight_kg - prev3.weight_kg) / daysBetween(prev3.date, last.date)) * 7 : null;
  const early = p.plan_start_date && daysBetween(p.plan_start_date, last.date) <= 15;
  const change = `${sgn(last.weight_kg - prev.weight_kg)} kg od ${fmtShort(prev.date)}`;

  if (p.goal === 'cut') {
    const loss = -rate;
    if (loss > Math.max(1, last.weight_kg * 0.01)) {
      if (early) add('info', `${change}. Szybki spadek w pierwszych tygodniach to głównie woda – to normalne, dalej tempo zwolni.`);
      else add('warn', `${change} – to szybciej niż bezpieczne tempo (${f1(loss)} kg/tydz.). Za szybkie chudnięcie zabiera mięśnie. Jedz bliżej limitu i pilnuj białka.`);
    } else if (loss >= 0.3) add('ok', `${change} (ok. ${f1(loss)} kg/tydz.) – tempo zgodne z planem. Tak trzymaj! 💪`);
    else if (loss >= 0.15) add('ok', `${change} (ok. ${f1(loss)} kg/tydz.) – trochę wolniej niż plan, ale idzie w dobrą stronę.`);
    else if (over) add('warn', `${change} – waga prawie stoi, a jedzenie było średnio o ${r0(st.kcal - st.budget)} kcal ponad limit. Wróć do limitu, a waga ruszy.`);
    else if (rate3 != null && -rate3 < 0.15 && st.n >= 4) {
      const lower = Math.max(p.sex === 'm' ? 1500 : 1200, p.kcal_target - 150);
      add('warn', `Od ok. 3 tygodni waga stoi, mimo że trzymasz limit. Organizm potrzebuje chyba mniej, niż wyliczył wzór. Proponuję obniżyć cel do ok. ${lower} kcal (Profil → Dostosuj ręcznie).`);
    } else add('info', `${change} – w tym tygodniu prawie bez zmian. Waga skacze o 0,5–1 kg z dnia na dzień (woda, sól, cykl), dlatego liczy się trend z 2–3 tygodni. Trzymaj kurs.`);
  } else if (p.goal === 'gain') {
    if (rate > 0.5) add('warn', `${change} – przybierasz szybciej niż zakładamy (${f1(rate)} kg/tydz.). Część to może być tłuszcz – zmniejsz trochę porcje.`);
    else if (rate >= 0.1) add('ok', `${change} – tempo zgodne z planem. 💪`);
    else add('info', `${change} – waga stoi. Jeśli tak będzie kolejny tydzień, dodaj ok. 150 kcal dziennie.`);
  } else {
    const r = rate3 ?? rate;
    if (Math.abs(r) <= 0.3) add('ok', `${change} – waga stabilna. 👍`);
    else add('info', `${change} – waga ${r < 0 ? 'spada' : 'rośnie'} (ok. ${f1(Math.abs(r))} kg/tydz.). Jeśli to się utrzyma, ${r < 0 ? 'dodaj' : 'odejmij'} ok. 150 kcal dziennie.`);
  }

  if (st.n < Math.min(4, st.span)) add('info', `Posiłki wpisane w ${st.n} z ${st.span} dni – przy luźniejszych wpisach trudniej ocenić, co działa.`);
  else {
    const pct = r0((st.kcal / st.budget) * 100);
    add(over ? 'warn' : 'ok', `Kalorie: średnio ${r0(st.kcal)} z ${r0(st.budget)} kcal limitu (${pct}%), wpisy w ${st.n} z ${st.span} dni.`);
    if (st.protein < p.protein_g * 0.85) add('warn', `Białko: średnio ${r0(st.protein)} g, cel ${p.protein_g} g – przy redukcji to ważne, żeby nie tracić mięśni.`);
    else add('ok', `Białko: średnio ${r0(st.protein)} g (cel ${p.protein_g} g). ✔`);
  }
  if (st.actMin) add('info', `Aktywność w tym okresie: ${r0(st.actMin)} min.`);
  return msgs;
}

/* ---------- Tydzień po tygodniu ---------- */
export function weekRows(p, start, today, weights, entries, acts) {
  const rows = [];
  let lastW = p.plan_start_weight ?? [...weights].reverse().find(w => w.date <= start)?.weight_kg ?? null;
  for (let i = 0; ; i++) {
    const a = addDays(start, i * 7), b = addDays(a, 6);
    if (a > today) break;
    const st = periodStats(entries, acts, p, addDays(a, -1), b < today ? b : today);
    const inW = weights.filter(w => w.date >= a && w.date <= b);
    const w = inW.length ? inW[inW.length - 1].weight_kg : null;
    const delta = w != null && lastW != null && !(i === 0 && w === lastW) ? w - lastW : null;
    if (w != null) lastW = w;
    let status = '⚪';
    if (st.n >= 4) {
      const kOk = st.kcal <= st.budget * 1.05 && st.kcal >= p.kcal_target * 0.75, pOk = st.protein >= p.protein_g * 0.85;
      status = kOk && pOk ? '🟢' : kOk || pOk ? '🟡' : '🔴';
    }
    rows.push({ i: i + 1, a, b, w, delta, st, status, current: b >= today });
  }
  return rows.reverse();
}

/* ---------- Wykres ---------- */
export function chart(p, start, weights, today) {
  const W = 360, H = 200, L = 30, R = 8, T = 10, B = 22;
  const ws = weights.filter(w => w.date >= start);
  const sw = p.plan_start_weight ?? ws[0]?.weight_kg;
  if (sw == null) return '';
  const pace = PACE[p.goal], tgt = p.target_weight_kg;
  const f = forecast(p, start, sw);
  const endDate = [today, addDays(start, 28), f && !f.done ? f.late : start].sort().pop();
  const span = Math.max(1, daysBetween(start, endDate));
  const vals = [sw, ...ws.map(w => +w.weight_kg)];
  if (tgt) vals.push(+tgt);
  const lo = Math.floor(Math.min(...vals) - 0.5), hi = Math.ceil(Math.max(...vals) + 0.5);
  const x = d => L + (daysBetween(start, d) / span) * (W - L - R);
  const y = v => T + ((hi - v) / (hi - lo || 1)) * (H - T - B);

  let corridor = '';
  if (pace) {
    const dir = p.goal === 'cut' ? -1 : 1, clamp = v => (tgt ? (dir < 0 ? Math.max(v, tgt) : Math.min(v, tgt)) : v);
    const steps = 24, ptsA = [], ptsB = [];
    for (let s = 0; s <= steps; s++) {
      const d = addDays(start, Math.round((span * s) / steps)), wk = daysBetween(start, d) / 7;
      ptsA.push(`${x(d).toFixed(1)},${y(clamp(sw + dir * pace.max * wk)).toFixed(1)}`);
      ptsB.unshift(`${x(d).toFixed(1)},${y(clamp(sw + dir * pace.min * wk)).toFixed(1)}`);
    }
    corridor = `<polygon points="${[...ptsA, ...ptsB].join(' ')}" fill="var(--accent)" opacity=".14"/>`;
  }
  const grid = [];
  const stepV = hi - lo > 8 ? 2 : 1;
  for (let v = lo; v <= hi; v += stepV) grid.push(`<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--border)" stroke-width="1"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${v}</text>`);
  const pts = ws.map(w => [x(w.date), y(+w.weight_kg)]);
  return `<svg viewBox="0 0 ${W} ${H}" class="wchart" role="img" aria-label="Wykres wagi">
    ${grid.join('')}${corridor}
    ${tgt ? `<line x1="${L}" x2="${W - R}" y1="${y(tgt)}" y2="${y(tgt)}" stroke="var(--accent)" stroke-dasharray="6 5" stroke-width="1.5"/>
      <text x="${W - R}" y="${y(tgt) - 5}" text-anchor="end" font-size="11" fill="var(--accent)">cel ${f1(tgt)} kg</text>` : ''}
    <line x1="${x(today)}" x2="${x(today)}" y1="${T}" y2="${H - B}" stroke="var(--muted)" stroke-dasharray="2 4" stroke-width="1"/>
    ${pts.length > 1 ? `<polyline points="${pts.map(q => q.join(',')).join(' ')}" fill="none" stroke="var(--info)" stroke-width="2" stroke-linejoin="round"/>` : ''}
    ${pts.map(([a, b]) => `<circle cx="${a}" cy="${b}" r="3.5" fill="var(--info)"/>`).join('')}
    <text x="${L}" y="${H - 6}" font-size="11" fill="var(--muted)">${esc(fmtShort(start))}</text>
    <text x="${W - R}" y="${H - 6}" text-anchor="end" font-size="11" fill="var(--muted)">${esc(fmtShort(endDate))}</text>
  </svg>
  <div class="legend"><span><i class="wl"></i>Twoja waga</span>${pace ? '<span><i class="ok"></i>bezpieczne tempo</span>' : ''}${tgt ? '<span><i class="tl"></i>cel</span>' : ''}</div>`;
}

/* ---------- Ekran Postępy ---------- */
export async function renderProgress(el) {
  const p = S.profile, today = todayStr();
  if (!$('.prog', el)) el.innerHTML = '<div class="loading">Ładowanie…</div>';
  const weights = (await db.weightAll()).map(w => ({ date: w.date, weight_kg: +w.weight_kg }));
  const start = p.plan_start_date || weights[0]?.date || today;
  const [entries, acts] = await Promise.all([
    db.entriesRange(addDays(start, -1), today, 'date,kcal,protein,carbs,fat,fiber'),
    db.actsRange(addDays(start, -1), today, 'date,kcal,minutes'),
  ]);
  if (S.tab !== 'progress') return;

  const goal = GOALS.find(g => g.id === p.goal);
  const sw = p.plan_start_weight ?? weights.find(w => w.date >= start)?.weight_kg ?? p.weight_kg;
  const last = weights[weights.length - 1];
  const now = last?.weight_kg ?? p.weight_kg;
  const tgt = p.target_weight_kg;
  const todayW = weights.find(w => w.date === today);
  const weeksIn = Math.max(0, daysBetween(start, last?.date || today) / 7);
  const changed = now - sw;
  let pct = null;
  if (tgt && sw !== tgt) pct = Math.max(0, Math.min(100, ((sw - now) / (sw - tgt)) * 100));
  const msgs = assess(p, weights.filter(w => w.date >= start), entries, acts);
  const rows = weekRows(p, start, today, weights, entries, acts);
  const fc = tgt && PACE[p.goal] ? forecastText(p, last?.date || today, now) : '';
  const actualRate = weeksIn >= 2 ? changed / weeksIn : null;
  let actualEta = '';
  if (tgt && actualRate && Math.sign(actualRate) === Math.sign(tgt - now) && Math.abs(actualRate) >= 0.1) {
    const wk = Math.abs(tgt - now) / Math.abs(actualRate);
    actualEta = `W Twoim dotychczasowym tempie (${sgn(actualRate)} kg/tydz.) – ok. ${fmtDate(addDays(last.date, Math.ceil(wk * 7)))}.`;
  }

  el.innerHTML = `<div class="prog"><header class="pagehead"><h1>Postępy</h1></header>
    <section class="card"><div class="sec-h"><h3>Plan: ${esc(goal?.label || '')}</h3><span class="muted small">od ${esc(fmtShort(start))}</span></div>
      <div class="stats">
        <div><b>${f1(sw)} kg</b><span>start</span></div>
        <div><b>${f1(now)} kg</b><span>teraz${last ? ' (' + esc(fmtShort(last.date)) + ')' : ''}</span></div>
        <div><b>${sgn(changed)} kg</b><span>zmiana od startu</span></div>
        <div><b>${tgt ? f1(tgt) + ' kg' : '—'}</b><span>${tgt ? `cel (${sgn(tgt - sw)} kg)` : 'cel nieustawiony'}</span></div>
      </div>
      ${pct != null ? `<div class="mb-top small"><span>Realizacja celu</span><span><b>${r0(pct)}%</b> · zostało ${f1(Math.max(0, Math.abs(tgt - now)))} kg</span></div>
        <div class="track big"><div class="fill" style="width:${pct}%"></div></div>` : ''}
      ${fc ? `<p class="small">${fc}</p>` : ''}${actualEta ? `<p class="small muted">${actualEta}</p>` : ''}
      <button class="btn" data-act="editGoalWeight">${tgt ? 'Zmień cel wagowy' : 'Ustaw cel, np. −4 kg'}</button>
    </section>

    <section class="card"><h3>Ocena ostatniego tygodnia</h3>
      ${msgs.map(m => `<div class="msg ${m.lvl}">${esc(m.text)}</div>`).join('')}</section>

    <section class="card"><h3>Ważenie</h3>
      <p class="small muted">Najlepiej raz w tygodniu, rano, na czczo, po toalecie – zawsze w tych samych warunkach.</p>
      <div class="row-input"><input id="pg-w" inputmode="decimal" value="${todayW ? f1(todayW.weight_kg) : ''}" placeholder="${f1(now)}" aria-label="Dzisiejsza waga w kg"><span>kg</span><button class="btn primary" data-act="weighIn" data-src="pg-w">Zapisz</button></div>
      ${todayW ? '<p class="small muted">Dzisiejszy pomiar jest już zapisany – możesz go poprawić.</p>' : ''}
    </section>

    <section class="card"><h3>Wykres wagi</h3>${weights.length ? chart(p, start, weights, today) : '<p class="muted">Brak pomiarów.</p>'}</section>

    <section class="card"><h3>Tydzień po tygodniu</h3>
      <p class="small muted">🟢 kalorie i białko w normie · 🟡 jedno z dwóch · 🔴 oba poza normą · ⚪ za mało wpisów</p>
      ${rows.map(r => `<div class="wrow"><div class="wr-st">${r.status}</div><div class="wr-mid">
        <div class="r-name">Tydzień ${r.i}${r.current ? ' (trwa)' : ''} <span class="muted small">${esc(fmtShort(r.a))} – ${esc(fmtShort(r.b))}</span></div>
        <div class="r-sub">${r.st.n ? `śr. ${r0(r.st.kcal)}/${r0(r.st.budget)} kcal · białko ${r0(r.st.protein)}/${p.protein_g} g · wpisy ${r.st.n} dni` : 'brak wpisów posiłków'}${r.st.actMin ? ` · ruch ${r0(r.st.actMin)} min` : ''}</div></div>
        <div class="wr-w">${r.w != null ? `<b>${f1(r.w)}</b>${r.delta != null ? `<span class="${(p.goal === 'gain' ? r.delta > 0 : r.delta < 0) ? 'good' : r.delta === 0 ? '' : 'bad'}">${sgn(r.delta)}</span>` : ''}` : '<span class="muted small">bez ważenia</span>'}</div></div>`).join('')}
    </section>

    <section class="card"><details><summary>Wszystkie pomiary (${weights.length})</summary>
      ${[...weights].reverse().map(w => `<div class="ing"><span class="ing-name">${esc(fmtDate(w.date))}</span><b>${f1(w.weight_kg)} kg</b><button class="x" data-act="delWeight" data-date="${w.date}" aria-label="Usuń pomiar">✕</button></div>`).join('')}
    </details>
    <button class="btn" data-act="restartPlan">Zacznij plan od nowa (od dzisiejszej wagi)</button></section>
  </div>`;
}

// Arkusz: ustaw cel jako „ile kg” albo jako wagę docelową
export function goalWeightFields(p) {
  const tgt = p.target_weight_kg, w = p.weight_kg;
  const [lo, hi] = healthyRange(p.height_cm);
  const diff = tgt ? r1(Math.abs(w - tgt)) : '';
  const word = p.goal === 'gain' ? 'przytyć' : 'schudnąć';
  return `<div class="grid2">
      <label>Ile kg chcesz ${word}?<input data-g="diff" inputmode="decimal" value="${diff ? f1(diff) : ''}" placeholder="np. 4"></label>
      <label>Waga docelowa<input data-g="target" inputmode="decimal" value="${tgt ? f1(tgt) : ''}" placeholder="kg"></label>
    </div>
    <p class="small muted">Zdrowy zakres wagi dla wzrostu ${f1(p.height_cm)} cm: ${f1(lo)}–${f1(hi)} kg (BMI 18,5–24,9).</p>
    <p class="small" data-g="fc"></p>`;
}

export function bindGoalWeight(root, getP) {
  const d = $('[data-g=diff]', root), t = $('[data-g=target]', root), fc = $('[data-g=fc]', root);
  const show = () => {
    const p = getP(), tv = num(t.value);
    fc.innerHTML = tv && PACE[p.goal] ? forecastText({ ...p, target_weight_kg: tv }, todayStr(), p.weight_kg) : '';
  };
  root.addEventListener('input', e => {
    const p = getP(), dir = p.goal === 'gain' ? 1 : -1;
    if (e.target === d) t.value = num(d.value) ? f1(p.weight_kg + dir * num(d.value)) : '';
    if (e.target === t) d.value = num(t.value) ? f1(Math.abs(p.weight_kg - num(t.value))) : '';
    if (e.target === d || e.target === t) show();
  });
  show();
}

// Sprawdza cel; zwraca [wartość lub null, komunikat błędu]
export function validateTarget(p, raw) {
  const tv = r1(num(raw));
  if (!tv) return [null, null];
  const [lo] = healthyRange(p.height_cm);
  if (p.goal === 'cut') {
    if (tv >= p.weight_kg) return [null, 'Przy redukcji waga docelowa musi być niższa od obecnej'];
    if (tv < lo) return [null, `To poniżej zdrowej wagi dla Twojego wzrostu (min. ${f1(lo)} kg)`];
  }
  if (p.goal === 'gain' && tv <= p.weight_kg) return [null, 'Przy budowie mięśni waga docelowa musi być wyższa od obecnej'];
  return [tv, null];
}
