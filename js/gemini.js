// Rozpoznawanie posiłków przez Google Gemini (darmowy plan)
// Klucz zapisywany jest tylko w tej przeglądarce (localStorage), nie w bazie ani w kodzie.

const LS_KEY = 'forma.geminiKey';
const LS_MODEL = 'forma.geminiModel';
export const DEFAULT_MODEL = 'gemini-flash-latest';

function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } }
function lsSet(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* prywatny tryb */ } }

export const getKey = () => lsGet(LS_KEY);
export const setKey = v => lsSet(LS_KEY, v.trim());
export const getModel = () => lsGet(LS_MODEL) || DEFAULT_MODEL;
export const setModel = v => lsSet(LS_MODEL, v.trim());

// Zmniejsza zdjęcie (szybciej i mniej danych)
export async function resizeImage(file, max = 1024) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((ok, err) => {
      img.onload = ok;
      img.onerror = () => err(new Error('Nie udało się wczytać zdjęcia. Spróbuj innego (JPG lub PNG).'));
      img.src = url;
    });
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s);
    c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.82));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function blobToBase64(blob) {
  return new Promise((ok, err) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1]);
    r.onerror = err;
    r.readAsDataURL(blob);
  });
}

const N = { type: 'NUMBER' };
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          amount: N,
          unit: { type: 'STRING', enum: ['g', 'szt'] },
          kcal: N, protein: N, carbs: N, fat: N, fiber: N,
          matched_food_id: { type: 'STRING', nullable: true },
        },
        required: ['name', 'amount', 'unit', 'kcal', 'protein', 'carbs', 'fat', 'fiber'],
      },
    },
    note: { type: 'STRING' },
  },
  required: ['items'],
};

export async function analyzeMeal({ imageBlob, text, foods }) {
  const key = getKey();
  if (!key) throw new Error('Brak klucza Gemini – dodaj go w zakładce Profil.');
  const model = getModel();

  const base = (foods || []).slice(0, 150).map(f =>
    `${f.id} | ${f.name} | ${f.basis === 'g' ? 'na 100 g' : 'na 1 ' + (f.unit_label || 'porcję')} | ${f.kcal} kcal, B ${f.protein} g, W ${f.carbs} g, T ${f.fat} g`
  ).join('\n');

  const prompt = `Jesteś doświadczonym dietetykiem. ${imageBlob ? 'Na zdjęciu jest posiłek lub napój.' : 'Użytkownik opisał posiłek tekstem.'}
Rozpoznaj każdy produkt/składnik osobno, oszacuj wielkość porcji i podaj wartości odżywcze DLA CAŁEJ TEJ PORCJI: kcal, białko, węglowodany, tłuszcz i błonnik (w gramach).
Nazwy krótko, po polsku. Jednostka "szt" dla rzeczy policzalnych (naleśnik, jajko, kromka, kanapka, owoc), w pozostałych przypadkach "g" (napoje też w g, 1 ml ≈ 1 g).
${text ? `Informacje od użytkownika (traktuj jako ważniejsze niż zdjęcie): """${text}"""` : ''}

Zapisana baza posiłków użytkownika (id | nazwa | na jednostkę | wartości):
${base || '(pusta)'}

Jeśli rozpoznany produkt odpowiada pozycji z bazy, ustaw matched_food_id na jej id i podaj amount w jednostce tej pozycji (gramy dla pozycji "na 100 g", liczba sztuk/porcji dla pozostałych). W przeciwnym razie matched_food_id = null.
W polu note napisz krótko po polsku, czego nie jesteś pewien (np. "nie widać, czy jest masło").`;

  const parts = [{ text: prompt }];
  if (imageBlob) parts.push({ inline_data: { mime_type: 'image/jpeg', data: await blobToBase64(imageBlob) } });

  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.2 },
      }),
    });
  } catch {
    throw new Error('Brak połączenia z Gemini. Sprawdź internet.');
  }

  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json())?.error?.message || ''; } catch { /* */ }
    if (res.status === 429) throw new Error('Wykorzystany darmowy limit Gemini. Odczekaj minutę albo spróbuj jutro. Możesz też wpisać posiłek ręcznie.');
    if (res.status === 404) throw new Error(`Model „${model}” jest niedostępny. W Profilu zmień nazwę modelu (np. gemini-2.5-flash).`);
    if (res.status === 400 && /api key/i.test(msg)) throw new Error('Nieprawidłowy klucz Gemini. Sprawdź go w Profilu.');
    if (res.status === 403) throw new Error('Klucz Gemini nie ma dostępu. Utwórz nowy w Google AI Studio.');
    if (res.status >= 500) throw new Error('Serwery Gemini są teraz przeciążone. Spróbuj za chwilę.');
    throw new Error('Błąd Gemini: ' + (msg || res.status));
  }

  const data = await res.json();
  const txt = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('');
  if (!txt) throw new Error('Gemini nie rozpoznał posiłku. Spróbuj zrobić wyraźniejsze zdjęcie albo dopisz opis.');
  try {
    return JSON.parse(txt);
  } catch {
    throw new Error('Gemini zwrócił nieczytelną odpowiedź. Spróbuj ponownie.');
  }
}
