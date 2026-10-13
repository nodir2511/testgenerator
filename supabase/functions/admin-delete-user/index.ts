// Edge Function: admin-delete-user
//
// Удаление учётной записи пользователя. Доступно только главному администратору (is_owner).
// Вопросы и билеты, созданные пользователем, остаются (автор становится «неизвестным»),
// привязка Telegram и назначенные предметы удаляются каскадом.
//
// Деплой: supabase functions deploy admin-delete-user

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const callerToken = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    if (!callerToken) return json({ error: 'Требуется авторизация' }, 401);

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: callerAuth, error: callerAuthError } = await adminClient.auth.getUser(callerToken);
    if (callerAuthError || !callerAuth?.user) return json({ error: 'Недействительная сессия' }, 401);

    const { data: caller } = await adminClient.from('profiles').select('role, is_owner').eq('id', callerAuth.user.id).single();
    if (caller?.role !== 'admin' || caller?.is_owner !== true) {
      return json({ error: 'Удалять пользователей может только главный администратор' }, 403);
    }

    const body = await req.json();
    const userId = String(body.userId ?? '');
    if (!userId) return json({ error: 'Не указан пользователь' }, 400);
    if (userId === callerAuth.user.id) return json({ error: 'Нельзя удалить самого себя' }, 400);

    const { data: target } = await adminClient.from('profiles').select('email, role, is_owner').eq('id', userId).maybeSingle();
    if (!target) return json({ error: 'Пользователь не найден' }, 404);
    if (target.is_owner) return json({ error: 'Нельзя удалить главного администратора' }, 400);

    const { error: delError } = await adminClient.auth.admin.deleteUser(userId);
    if (delError) return json({ error: delError.message }, 400);

    await adminClient.from('audit_logs').insert({
      user_id: callerAuth.user.id,
      action: 'DELETE_USER',
      entity_type: 'profiles',
      entity_id: userId,
      details: { email: target.email, role: target.role },
    });

    return json({ ok: true, email: target.email });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Внутренняя ошибка' }, 500);
  }
});
