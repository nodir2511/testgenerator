// Edge Function: admin-create-user
//
// Позволяет администратору создать новый аккаунт (email + пароль) без
// потери собственной сессии. Работает через service role key, поэтому
// обязательно выполняется на сервере (Supabase Edge Functions), а не в браузере.
//
// Самостоятельная регистрация закрыта (supabase/sql/security_round3.sql): база создаёт
// аккаунт, только если эта функция заранее записала приглашение на email (account_invites).
// Пароль задаёт администратор, поэтому при первом входе человек обязан сменить его на свой.
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

// Понятные сообщения вместо внутренних текстов Supabase
function createErrorText(message: string | undefined): string {
  const m = (message || '').toLowerCase();
  if (m.includes('already') || m.includes('registered') || m.includes('exists')) return 'Пользователь с таким email уже есть';
  if (m.includes('email') && (m.includes('invalid') || m.includes('format'))) return 'Некорректный email';
  if (m.includes('password')) return 'Пароль не подходит: сделайте его длиннее или сложнее';
  return 'Не удалось создать пользователя';
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
      return json({ error: 'Только администратор может создавать учётные записи' }, 403);
    }

    const body = await req.json();
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const fullName = String(body.fullName ?? '').trim().slice(0, 200);
    const ROLES = ['user', 'admin', 'subject_teacher', 'subject_admin'];
    const role = ROLES.includes(body.role) ? String(body.role) : 'user';
    const bySubject = role === 'subject_teacher' || role === 'subject_admin';
    const subjectIds: string[] = Array.isArray(body.subjectIds) ? body.subjectIds.filter((x: unknown) => typeof x === 'string') : [];
    // Любая роль, кроме обычного преподавателя, — только у главного администратора
    if (role !== 'user' && !callerProfile.is_owner) {
      return json({ error: 'Эту роль назначает только главный администратор' }, 403);
    }
    if (bySubject && !subjectIds.length) return json({ error: 'Выберите хотя бы один предмет' }, 400);

    if (!email || !password || password.length < 6) {
      return json({ error: 'Укажите email и пароль (не менее 6 символов)' }, 400);
    }

    // Приглашение на 10 минут: без него база не даст создать аккаунт
    const { error: inviteError } = await adminClient
      .from('account_invites')
      .upsert({ email, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
    if (inviteError) {
      console.error('account_invites', inviteError);
      return json({ error: 'Не удалось создать пользователя' }, 500);
    }

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (createError || !created?.user) {
      await adminClient.from('account_invites').delete().eq('email', email);
      console.error('createUser', createError);
      return json({ error: createErrorText(createError?.message) }, 400);
    }

    // Триггер on_auth_user_created уже создал профиль с ролью 'user'.
    // Пароль придумал администратор — при первом входе человек сменит его на свой.
    await adminClient.from('profiles').update({ role, must_change_password: true }).eq('id', created.user.id);
    if (bySubject) {
      await adminClient.from('user_subjects').insert(subjectIds.map((subject_id) => ({ user_id: created.user.id, subject_id })));
    }

    await adminClient.from('audit_logs').insert({
      user_id: callerAuth.user.id,
      action: 'CREATE_USER',
      entity_type: 'profiles',
      entity_id: created.user.id,
      details: { email, role, subjectIds },
    });

    return json({ id: created.user.id, email: created.user.email, role });
  } catch (err) {
    console.error('admin-create-user', err);
    return json({ error: 'Внутренняя ошибка. Попробуйте ещё раз.' }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
