import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond(405, { error: 'POST のみ利用できます。' });

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return respond(401, { error: 'ログインが必要です。' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error('Supabase function environment is incomplete.');
    return respond(500, { error: 'サーバー設定が不足しています。管理者に連絡してください。' });
  }

  const accessToken = authorization.slice('Bearer '.length);
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
  if (authError || !authData.user) return respond(401, { error: 'ログイン状態を確認できません。' });

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data: requester, error: requesterError } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', authData.user.id)
    .single();
  if (requesterError || requester?.role !== '管理者') {
    return respond(403, { error: 'ユーザーを作成する権限がありません。' });
  }

  let input: { email?: unknown; name?: unknown; password?: unknown; role?: unknown };
  try {
    input = await request.json();
  } catch {
    return respond(400, { error: 'リクエスト内容を読み取れません。' });
  }

  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const role = input.role;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return respond(400, { error: 'メールアドレスを確認してください。' });
  if (!name || name.length > 40) return respond(400, { error: '表示名は1〜40文字で入力してください。' });
  if (password.length < 8) return respond(400, { error: '初期パスワードは8文字以上にしてください。' });
  if (role !== '管理者' && role !== 'ドライバー') return respond(400, { error: '役割を選択してください。' });

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name }
  });
  if (createError || !created.user) {
    console.error('Supabase Auth user creation failed.', createError);
    return respond(400, { error: createError?.message || 'ユーザーを作成できませんでした。' });
  }

  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .update({ name, role })
    .eq('id', created.user.id)
    .select('id,name,role')
    .single();
  if (profileError || !profile) {
    console.error('Created user profile could not be configured.', profileError);
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(created.user.id);
    if (deleteError) console.error('Failed to remove the partially created auth user.', deleteError);
    return respond(500, { error: 'プロフィールを設定できませんでした。Supabase のログを確認してください。' });
  }

  return respond(201, { user: profile });
});
