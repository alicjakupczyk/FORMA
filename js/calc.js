// Obliczenia: zapotrzebowanie, makro, sumy, podsumowanie tygodnia

export const LIFESTYLES = [
  { id: 'sedentary', label: 'Siedzący', desc: 'Praca przy biurku, mało chodzenia', f: 1.2 },
  { id: 'light', label: 'Lekko aktywny', desc: 'Trochę chodzenia w ciągu dnia', f: 1.375 },
  { id: 'active', label: 'Aktywny', desc: 'Praca w ruchu, dużo chodzenia', f: 1.55 },
];

export const GOALS = [
  { id: 'cut', label: 'Redukcja', desc: 'Spokojne chudnięcie (ok. 0,3–0,5 kg na tydzień), dużo białka, żeby chronić mięśnie' },
  { id: 'maintain', label: 'Utrzymanie wagi', desc: 'Zdrowe proporcje bez deficytu kalorii' },
  { id: 'gain', label: 'Budowa mięśni', desc: 'Niewielka nadwyżka kalorii i dużo białka' },
];

export const MEALS = [
  { id: 'sniadanie', label: 'Śniadanie' },
  { id: 'drugie', label: 'II śniadanie' },
  { id: 'obiad', label: 'Obiad' },
  { id: 'podwieczorek', label: 'Podwieczorek' },
  { id: 'kolacja', label: 'Kolacja' },
  { id: 'przekaska', label: 'Przekąski' },
];

export function defaultMeal() {
  const h = new Date().getHours();
  return h < 10 ? 'sniadanie' : h < 12 ? 'drugie' : h < 16 ? 'obiad' : h < 18 ? 'podwieczorek' : 'kolacja';
}

export const r0 = n => Math.round(+n || 0);
export const r1 = n => Math.round((+n || 0) * 10) / 10;
export const NUTR = ['kcal', 'protein', 'carbs', 'fat', 'fiber'];

// Wzór Mifflina-St Jeora
export function bmr(p) {
  const b = 10 * p.weight_kg + 6.25 * p.height_cm - 5 * p.age;
  return p.sex === 'm' ? b + 5 : b - 161;
}

export function computeTargets(p) {
  const f = LIFESTYLES.find(l => l.id === p.lifestyle)?.f ?? 1.375;
  const base = bmr(p);
  const tdee = base * f;
  let kcal = p.goal === 'cut' ? tdee * 0.8 : p.goal === 'gain' ? tdee * 1.1 : tdee;
  kcal = Math.max(p.sex === 'm' ? 1500 : 1200, Math.round(kcal / 10) * 10);
  // przy wysokim BMI białko liczymy od wagi "referencyjnej", żeby nie zawyżać
  const refW = Math.min(p.weight_kg, 27 * (p.height_cm / 100) ** 2);
  const protein = Math.round(refW * (p.goal === 'maintain' ? 1.6 : 1.8));
  const fat = Math.round(Math.max((kcal * 0.27) / 9, refW * 0.8));
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return {
    bmr: Math.round(base), tdee: Math.round(tdee),
    kcal_target: kcal, protein_g: protein, carbs_g: carbs, fat_g: fat, fiber_g: p.sex === 'm' ? 30 : 25,
  };
}

// food.basis: 'g' = wartości na 100 g, 'szt' = na 1 sztukę/porcję
export function foodValues(food, amount) {
  const k = food.basis === 'g' ? amount / 100 : amount;
  const o = {};
  for (const n of NUTR) o[n] = r1((+food[n] || 0) * k);
  o.kcal = r0(o.kcal);
  return o;
}

export function sum(rows) {
  const o = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  for (const r of rows) for (const n of NUTR) o[n] += +r[n] || 0;
  return o;
}

// Aktywność dodaje do limitu połowę spalonych kalorii (przeliczniki zwykle je zawyżają)
export const budget = (profile, actKcal) => (profile.kcal_target || 0) + Math.round((actKcal || 0) * 0.5);

export function weeklyCheck(entries, acts, p) {
  const byDay = {};
  for (const e of entries) (byDay[e.date] ||= []).push(e);
  const days = Object.keys(byDay);
  if (days.length < 3) {
    return {
      days: days.length,
      msgs: [{ lvl: 'info', text: `Za mało danych na podsumowanie tygodnia (dni z wpisami: ${days.length} z 7). Wpisuj posiłki codziennie, a podpowiem, czego brakuje.` }],
    };
  }
  const totals = days.map(d => sum(byDay[d]));
  const avg = {};
  for (const n of NUTR) avg[n] = totals.reduce((s, t) => s + t[n], 0) / days.length;
  const actByDay = {};
  for (const a of acts) actByDay[a.date] = (actByDay[a.date] || 0) + (+a.kcal || 0);
  const avgBudget = days.reduce((s, d) => s + budget(p, actByDay[d]), 0) / days.length;

  const msgs = [];
  if (avg.protein < p.protein_g * 0.85)
    msgs.push({ lvl: 'warn', text: `Za mało białka: średnio ${r0(avg.protein)} g dziennie, a cel to ${p.protein_g} g. Dorzuć np. skyr, twaróg, jajka, kurczaka, tuńczyka albo soczewicę.` });
  if (avg.kcal > avgBudget * 1.05)
    msgs.push({ lvl: 'warn', text: `Średnio ${r0(avg.kcal - avgBudget)} kcal dziennie ponad limit. Sprawdź przekąski i napoje – często tam „uciekają” kalorie.` });
  if (avg.kcal < p.kcal_target * 0.75)
    msgs.push({ lvl: 'warn', text: `Jesz bardzo mało (średnio ${r0(avg.kcal)} kcal). Zbyt duży deficyt sprzyja utracie mięśni i zmęczeniu – postaraj się zbliżyć do ${p.kcal_target} kcal.` });
  if (avg.fiber < p.fiber_g * 0.75)
    msgs.push({ lvl: 'warn', text: `Mało błonnika: średnio ${r0(avg.fiber)} g (cel ${p.fiber_g} g). Pomogą warzywa, owoce, pieczywo pełnoziarniste, płatki owsiane i strączki.` });
  if (avg.fat < p.fat_g * 0.6)
    msgs.push({ lvl: 'info', text: `Mało tłuszczu (średnio ${r0(avg.fat)} g). Zdrowe tłuszcze – oliwa, orzechy, awokado, ryby – są potrzebne m.in. dla hormonów.` });
  if (!msgs.length) msgs.push({ lvl: 'ok', text: 'Dobry tydzień! Kalorie, białko i błonnik w normie. 💪' });
  return { days: days.length, avg, msgs };
}
