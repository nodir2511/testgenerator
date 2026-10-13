// Edge Function: admin-update-user
//
// Позволяет администратору изменить данные любого пользователя:
// имя, email, пароль. Email и пароль меняются только через service role key.
//
// Деплой: supabase functions deploy admin-update-user

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

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: callerAuth, error: callerAuthError } = await adminClient.auth.getUser(callerToken);
    if (callerAuthError || !callerAuth?.user) {
      return json({ error: 'Недействительная сессия' }, 401);
    }

    const { data: callerProfile } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', callerAuth.user.id)
      .single();

    if (callerProfile?.role !== 'admin') {
      return json({ error: 'Только администратор может изменять данные пользователей' }, 403);
    }

    const body = await req.json();
    const userId = String(body.userId ?? '');
    if (!userId) {
      return json({ error: 'Не указан пользователь' }, 400);
    }

    const authUpdate: Record<string, unknown> = {};
    const profileUpdate: Record<string, unknown> = {};
    const changed: string[] = [];

    if (typeof body.email === 'string' && body.email.trim()) {
      const email = body.email.trim();
      authUpdate.email = email;
      authUpdate.email_confirm = true;
      profileUpdate.email = email;
      changed.push('email');
    }

    if (typeof body.password === 'string' && body.password.length > 0) {
      if (body.password.length < 6) {
        return json({ error: 'Пароль должен быть не менее 6 символов' }, 400);
      }
      authUpdate.password = body.password;
      changed.push('password');
    }

    if (typeof body.fullName === 'string') {
      const fullName = body.fullName.trim();
      authUpdate.user_metadata = { full_name: fullName };
      profileUpdate.full_name = fullName;
      changed.push('full_name');
    }

    if (changed.length === 0) {
      return json({ error: 'Нечего изменять' }, 400);
    }

    if (Object.keys(authUpdate).length > 0) {
      const { error } = await adminClient.auth.admin.updateUserById(userId, authUpdate);
      if (error) {
        return json({ error: error.message }, 400);
      }
    }

    if (Object.keys(profileUpdate).length > 0) {
      const { error } = await adminClient.from('profiles').update(profileUpdate).eq('id', userId);
      if (error) {
        return json({ error: error.message }, 400);
      }
    }

    // Сменили пароль — привязанные Telegram-чаты отключаем (пользователь привяжет заново с новой сессии)
    if (changed.includes('password')) {
      await adminClient.from('telegram_links').delete().eq('user_id', userId);
    }

    await adminClient.from('audit_logs').insert({
      user_id: callerAuth.user.id,
      action: 'UPDATE_USER',
      entity_type: 'profiles',
      entity_id: userId,
      details: { changed },
    });

    return json({ id: userId, changed });
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
