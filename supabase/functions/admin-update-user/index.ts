// Edge Function: admin-update-user
//
// Позволяет администратору изменить данные пользователя: имя, email, пароль.
// Email и пароль меняются только через service role key.
//
// Права: главный администратор меняет данные любого аккаунта; обычный администратор —
// только свои и тех, кто не администратор. Иначе второй админ мог бы сменить пароль
// главному и войти под ним.
// Если пароль задал администратор (не сам человек), при следующем входе его нужно сменить.
//
// Деплой: supabase functions deploy admin-update-user

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Понятные сообщения вместо внутренних текстов Supabase
function updateErrorText(message: string | undefined): string {
  const m = (message || '').toLowerCase();
  if (m.includes('already') || m.includes('registered') || m.includes('exists')) return 'Этот email уже занят другим пользователем';
  if (m.includes('email') && (m.includes('invalid') || m.includes('format'))) return 'Некорректный email';
  if (m.includes('password')) return 'Пароль не подходит: сделайте его длиннее или сложнее';
  if (m.includes('not found')) return 'Пользователь не найден';
  return 'Не удалось сохранить изменения';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const callerToken = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    if (!callerToken) {
      return json({ error: 'Требуется авторизация' }, 401);
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const { data: callerAuth, error: callerAuthError } = await adminClient.auth.getUser(callerToken);
    if (callerAuthError || !callerAuth?.user) {
      return json({ error: 'Недействительная сессия' }, 401);
    }

    const { data: callerProfile } = await adminClient
      .from('profiles')
      .select('role, is_owner')
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

    const { data: target } = await adminClient.from('profiles').select('role, is_owner').eq('id', userId).maybeSingle();
    if (!target) return json({ error: 'Пользователь не найден' }, 404);
    const self = userId === callerAuth.user.id;
    if (!callerProfile.is_owner && !self && (target.is_owner || target.role === 'admin')) {
      return json({ error: 'Данные администраторов меняет только главный администратор' }, 403);
    }

    const authUpdate: Record<string, unknown> = {};
    const profileUpdate: Record<string, unknown> = {};
    const changed: string[] = [];

    if (typeof body.email === 'string' && body.email.trim()) {
      const email = body.email.trim().toLowerCase();
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
      // Пароль, заданный администратором, человек при входе сменит на свой
      if (!self) profileUpdate.must_change_password = true;
    }

    if (typeof body.fullName === 'string') {
      const fullName = body.fullName.trim().slice(0, 200);
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
        console.error('updateUserById', error);
        return json({ error: updateErrorText(error.message) }, 400);
      }
    }

    // Профиль — после смены пароля: база сама снимает флаг смены пароля при новом пароле
    if (Object.keys(profileUpdate).length > 0) {
      const { error } = await adminClient.from('profiles').update(profileUpdate).eq('id', userId);
      if (error) {
        console.error('profiles update', error);
        return json({ error: 'Не удалось сохранить изменения' }, 400);
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
    console.error('admin-update-user', err);
    return json({ error: 'Внутренняя ошибка. Попробуйте ещё раз.' }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
