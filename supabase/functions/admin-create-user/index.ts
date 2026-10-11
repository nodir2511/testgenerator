// Edge Function: admin-create-user
//
// Позволяет администратору создать новый аккаунт (email + пароль) без
// потери собственной сессии. Работает через service role key, поэтому
// обязательно выполняется на сервере (Supabase Edge Functions), а не в браузере.
//
// Деплой: supabase functions deploy admin-create-user
// Секреты SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY задаются Supabase автоматически.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const callerToken = authHeader.replace('Bearer ', '');
    if (!callerToken) {
      return json({ error: 'Требуется авторизация' }, 401);
    }

    // Клиент от имени вызывающего — чтобы проверить, что он действительно админ
    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: callerAuth, error: callerAuthError } = await callerClient.auth.getUser(callerToken);
    if (callerAuthError || !callerAuth?.user) {
      return json({ error: 'Недействительная сессия' }, 401);
    }

    const { data: callerProfile, error: callerProfileError } = await callerClient
      .from('profiles')
      .select('role')
      .eq('id', callerAuth.user.id)
      .single();

    if (callerProfileError || callerProfile?.role !== 'admin') {
      return json({ error: 'Только администратор может создавать учётные записи' }, 403);
    }

    const body = await req.json();
    const email = String(body.email ?? '').trim();
    const password = String(body.password ?? '');
    const fullName = String(body.fullName ?? '').trim();
    const role = body.role === 'admin' ? 'admin' : 'user';

    if (!email || !password || password.length < 6) {
      return json({ error: 'Укажите email и пароль (не менее 6 символов)' }, 400);
    }

    // Админ-клиент с полными правами для создания пользователя
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (createError || !created?.user) {
      return json({ error: createError?.message ?? 'Не удалось создать пользователя' }, 400);
    }

    // Триггер on_auth_user_created уже создаёт профиль с ролью 'user' по умолчанию.
    // Если админ запросил роль 'admin' — проставляем её отдельно.
    if (role === 'admin') {
      await adminClient.from('profiles').update({ role: 'admin' }).eq('id', created.user.id);
    }

    await adminClient.from('audit_logs').insert({
      user_id: callerAuth.user.id,
      action: 'CREATE_USER',
      entity_type: 'profiles',
      entity_id: created.user.id,
      details: { email, role },
    });

    return json({ id: created.user.id, email: created.user.email, role });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Внутренняя ошибка' }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
