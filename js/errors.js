import { toast } from './ui.js';

export function friendlyError(e) {
  const m = e?.message || String(e);
  if (/Invalid login credentials/i.test(m)) return 'Nieprawidłowy e-mail lub hasło.';
  if (/Signups not allowed|signup.*disabled/i.test(m)) return 'Rejestracja nowych kont jest wyłączona.';
  if (/already registered/i.test(m)) return 'To konto już istnieje – zaloguj się.';
  if (/Password should be at least/i.test(m)) return 'Hasło musi mieć co najmniej 6 znaków.';
  if (/Email not confirmed/i.test(m)) return 'E-mail nie jest potwierdzony. Kliknij link w mailu od Supabase albo wyłącz potwierdzanie (instrukcja, krok 2).';
  if (/rate limit/i.test(m)) return 'Za dużo prób. Odczekaj chwilę i spróbuj ponownie.';
  if (/does not exist|Could not find the table|schema cache/i.test(m)) return 'Baza danych nie jest jeszcze przygotowana – uruchom plik schema.sql w Supabase (instrukcja, krok 1).';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Brak połączenia z internetem.';
  return m;
}

// Owija funkcję: błędy pokazuje jako komunikat zamiast "psuć" aplikację
export const safe = fn => async (...args) => {
  try {
    return await fn(...args);
  } catch (e) {
    console.error(e);
    toast(friendlyError(e), 'err');
  }
};
