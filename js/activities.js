// Przeliczniki aktywności (MET – wielokrotność spoczynkowego spalania)
export const ACTIVITIES = [
  { id: 'joga', label: 'Joga (spokojna, hatha)', met: 2.5 },
  { id: 'joga_dyn', label: 'Joga dynamiczna (vinyasa, power)', met: 4.0 },
  { id: 'silownia', label: 'Trening siłowy (umiarkowany)', met: 3.5 },
  { id: 'silownia_int', label: 'Trening siłowy (intensywny)', met: 6.0 },
  { id: 'dom', label: 'Ćwiczenia w domu (ogólne)', met: 3.8 },
  { id: 'hiit', label: 'HIIT / interwały', met: 8.0 },
  { id: 'pilates', label: 'Pilates', met: 3.0 },
  { id: 'rozciaganie', label: 'Rozciąganie / mobilność', met: 2.3 },
  { id: 'spacer', label: 'Spacer', met: 3.5 },
  { id: 'marsz', label: 'Szybki marsz / nordic walking', met: 4.8 },
  { id: 'kroki', label: 'Kroki (z telefonu lub zegarka)', steps: true },
  { id: 'bieg', label: 'Bieganie (ok. 8 km/h)', met: 8.3 },
  { id: 'rower', label: 'Rower (rekreacyjnie)', met: 5.8 },
  { id: 'rowerek', label: 'Rowerek stacjonarny', met: 6.8 },
  { id: 'plywanie', label: 'Pływanie (rekreacyjnie)', met: 6.0 },
  { id: 'taniec', label: 'Taniec / zumba', met: 5.5 },
  { id: 'schody', label: 'Wchodzenie po schodach', met: 4.0 },
  { id: 'sprzatanie', label: 'Sprzątanie / prace domowe', met: 3.3 },
  { id: 'ogrod', label: 'Prace w ogrodzie', met: 3.8 },
  { id: 'inne', label: 'Inna (kalorie wpiszę sama)', custom: true },
];

export const QUICK_ACTS = [
  { id: 'joga', minutes: 60, label: 'Joga 60 min' },
  { id: 'spacer', minutes: 30, label: 'Spacer 30 min' },
  { id: 'silownia', minutes: 45, label: 'Siłownia 45 min' },
  { id: 'dom', minutes: 20, label: 'Ćwiczenia w domu 20 min' },
];

export function activityKcal(act, { minutes, steps }, weightKg) {
  if (!act) return 0;
  if (act.steps) return Math.round((steps || 0) * weightKg * 0.0005);
  if (act.custom) return null;
  return Math.round((act.met * weightKg * (minutes || 0)) / 60);
}
