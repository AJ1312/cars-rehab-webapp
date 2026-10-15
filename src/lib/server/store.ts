import path from 'node:path';
import { createFileStore } from './store-file';
import { createSupabaseStore } from './store-supabase';
import type { Store } from './types';

const g = globalThis as unknown as { __carsStore?: Store };

export function getStore(): Store {
  if (g.__carsStore) return g.__carsStore;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const want = process.env.STORE;
  if ((want === 'supabase' || !want) && url && key) {
    g.__carsStore = createSupabaseStore(url, key);
  } else if (want === 'supabase') {
    throw new Error('STORE=supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  } else {
    if (process.env.VERCEL) throw new Error('No database configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the Vercel project settings.');
    g.__carsStore = createFileStore(path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || '.data'));
  }
  return g.__carsStore;
}
