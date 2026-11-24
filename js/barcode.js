// Skaner kodów kreskowych + baza Open Food Facts
import { r0, r1 } from './calc.js';
import { num } from './ui.js';

let scanner = null;

function loadLib() {
  if (window.Html5Qrcode) return Promise.resolve();
  return new Promise((ok, err) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
    s.onload = ok;
    s.onerror = () => err(new Error('Nie udało się wczytać skanera. Sprawdź internet.'));
    document.head.appendChild(s);
  });
}

export async function startScanner(elId, onCode) {
  await loadLib();
  await stopScanner();
  const F = window.Html5QrcodeSupportedFormats;
  scanner = new window.Html5Qrcode(elId, { formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E], verbose: false });
  let done = false;
  await scanner.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: (w, h) => ({ width: Math.max(150, Math.floor(w * 0.85)), height: Math.max(80, Math.floor(Math.min(w, h) * 0.45)) }) },
    text => {
      if (done) return;
      done = true;
      stopScanner().then(() => onCode(text));
    },
    () => {}
  );
}

export async function stopScanner() {
  if (!scanner) return;
  const s = scanner;
  scanner = null;
  try {
    if (s.isScanning) await s.stop();
    s.clear();
  } catch { /* już zatrzymany */ }
}

export async function lookupBarcode(code) {
  let r;
  try {
    r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,product_name_pl,brands,nutriments,serving_quantity`);
  } catch {
    throw new Error('Brak połączenia z bazą Open Food Facts.');
  }
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('Baza Open Food Facts nie odpowiada. Spróbuj za chwilę.');
  const j = await r.json();
  if (j.status !== 1 || !j.product) return null;
  const p = j.product, n = p.nutriments || {};
  let kcal = n['energy-kcal_100g'];
  if (kcal == null && n.energy_100g != null) kcal = n.energy_100g / 4.184;
  const name = [p.product_name_pl || p.product_name, (p.brands || '').split(',')[0]].filter(Boolean).join(' – ');
  return {
    name: name || `Produkt ${code}`,
    kcal: r0(kcal), protein: r1(n.proteins_100g), carbs: r1(n.carbohydrates_100g), fat: r1(n.fat_100g), fiber: r1(n.fiber_100g),
    serving: num(p.serving_quantity) || null,
    hasData: kcal != null,
  };
}
