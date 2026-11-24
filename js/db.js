import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.50.0/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function ok({ data, error }) {
  if (error) throw error;
  return data;
}

async function uid() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id;
}

const FOOD_COLS = ['name', 'basis', 'unit_label', 'unit_grams', 'kcal', 'protein', 'carbs', 'fat', 'fiber',
  'barcode', 'favorite', 'recipe', 'use_count', 'last_used_at'];

function pick(obj, cols) {
  const o = {};
  for (const c of cols) if (obj[c] !== undefined) o[c] = obj[c];
  return o;
}

export const db = {
  async getProfile() {
    return ok(await supabase.from('profiles').select('*').maybeSingle());
  },
  async saveProfile(p) {
    const row = { ...p, user_id: await uid(), updated_at: new Date().toISOString() };
    return ok(await supabase.from('profiles').upsert(row).select().single());
  },

  async listFoods() {
    return ok(await supabase.from('foods').select('*').order('created_at'));
  },
  async saveFood(f) {
    const row = pick(f, FOOD_COLS);
    if (f.id && !String(f.id).startsWith('cat:')) {
      return ok(await supabase.from('foods').update(row).eq('id', f.id).select().single());
    }
    return ok(await supabase.from('foods').insert(row).select().single());
  },
  async deleteFood(id) {
    ok(await supabase.from('foods').delete().eq('id', id));
  },

  async entriesRange(from, to, cols = '*') {
    return ok(await supabase.from('meal_entries').select(cols).gte('date', from).lte('date', to).order('created_at'));
  },
  async addEntries(rows) {
    return ok(await supabase.from('meal_entries').insert(rows).select());
  },
  async updateEntry(id, patch) {
    return ok(await supabase.from('meal_entries').update(patch).eq('id', id).select().single());
  },
  async deleteEntry(id) {
    ok(await supabase.from('meal_entries').delete().eq('id', id));
  },

  async actsRange(from, to, cols = '*') {
    return ok(await supabase.from('activities').select(cols).gte('date', from).lte('date', to).order('created_at'));
  },
  async saveAct(a) {
    const { id, ...row } = a;
    if (id) return ok(await supabase.from('activities').update(row).eq('id', id).select().single());
    return ok(await supabase.from('activities').insert(row).select().single());
  },
  async deleteAct(id) {
    ok(await supabase.from('activities').delete().eq('id', id));
  },

  async logWeight(date, kg) {
    ok(await supabase.from('weight_log').upsert({ user_id: await uid(), date, weight_kg: kg }));
  },
  async weightHistory() {
    return ok(await supabase.from('weight_log').select('*').order('date', { ascending: false }).limit(10));
  },
};
