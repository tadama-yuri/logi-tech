export const SUPABASE_URL = 'https://tihqubtpjsrzxzqptcer.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_GDVEIkrxnQ4CQOxws6tSdA_7RjNeZCc';

export function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}
