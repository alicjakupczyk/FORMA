import { todayStr } from './ui.js';

// Wspólny stan aplikacji
export const S = {
  session: null,
  profile: null,
  foods: [],
  date: todayStr(),
  tab: 'day',
  calMonth: null,
  onb: null,
  dayEntries: [],
  dayActs: [],
};

// Funkcje ustawiane przez app.js (żeby inne moduły mogły odświeżyć widok)
export const app = {
  go: () => {},
  refresh: () => {},
};
