import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { assertRowsChanged } from '../lib/errors';
import { Profile, UserRole, AuditLog, ROLE_LABELS } from '../types/database';
import { useAuth } from '../hooks/useAuth';
import { Users, ShieldCheck, UserCheck, Activity, Loader2, UserPlus, Pencil, Trash2, BookMarked } from 'lucide-react';

const SUBJECT_ROLES: UserRole[] = ['subject_teacher', 'subject_admin'];
const isSubjectRole = (r: UserRole) => SUBJECT_ROLES.includes(r);

// Выбор предметов для ролей «по предметам»
const SubjectPicker: React.FC<{
  subjects: Array<{ id: string; name: string }>;
  value: string[];
  onChange: (v: string[]) => void;
}> = ({ subjects, value, onChange }) => (
  <div className="flex flex-wrap gap-1.5">
    {subjects.map((sub) => {
      const on = value.includes(sub.id);
      return (
        <button
          key={sub.id}
          type="button"
          onClick={() => onChange(on ? value.filter((x) => x !== sub.id) : [...value, sub.id])}
          className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition ${
            on ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
          }`}
        >
          {on ? '✓ ' : ''}
          {sub.name}
        </button>
      );
    })}
  </div>
);

// supabase-js скрывает тело ответа при 4xx/5xx — достаём сообщение функции сами
async function functionErrorMessage(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json();
      if (body?.error) return String(body.error);
    } catch {
      /* тело не JSON */
    }
  }
  return (error as Error).message;
}

export const UserManagementView: React.FC = () => {
  const queryClient = useQueryClient();
  const { user: currentUser, isAdmin, isOwner } = useAuth();

  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('user');
  const [newSubjectIds, setNewSubjectIds] = useState<string[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  // Создание нового аккаунта администратором
  const createUserMutation = useMutation({
    mutationFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('Сессия не найдена, войдите заново');

      const { data, error } = await supabase.functions.invoke('admin-create-user', {
        body: {
          email: newEmail.trim(),
          password: newPassword,
          fullName: newFullName.trim(),
          role: newRole,
          subjectIds: isSubjectRole(newRole) ? newSubjectIds : [],
        },
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (error) throw new Error(await functionErrorMessage(error));
      if (data?.error) throw new Error(data.error);
      return data;
    },
    meta: { success: 'Аккаунт создан и сохранён в базе' },
    onSuccess: (data) => {
      setCreateError(null);
      setCreateSuccess(`Аккаунт ${data.email} создан`);
      setNewEmail('');
      setNewPassword('');
      setNewFullName('');
      setNewRole('user');
      setNewSubjectIds([]);
      queryClient.invalidateQueries({ queryKey: ['admin_profiles'] });
      queryClient.invalidateQueries({ queryKey: ['admin_user_subjects'] });
      queryClient.invalidateQueries({ queryKey: ['admin_audit_logs'] });
    },
    onError: (err: Error) => {
      setCreateSuccess(null);
      setCreateError(err.message);
    },
  });

  // Редактирование данных пользователя
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [editFullName, setEditFullName] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  const startEdit = (p: Profile) => {
    setEditingId(p.id);
    setEditEmail(p.email);
    setEditFullName(p.full_name || '');
    setEditPassword('');
    setEditError(null);
  };

  const updateUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('Сессия не найдена, войдите заново');

      const { data, error } = await supabase.functions.invoke('admin-update-user', {
        body: {
          userId,
          email: editEmail.trim(),
          fullName: editFullName.trim(),
          ...(editPassword ? { password: editPassword } : {}),
        },
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (error) throw new Error(await functionErrorMessage(error));
      if (data?.error) throw new Error(data.error);
      return data;
    },
    meta: { success: 'Данные пользователя обновлены в базе' },
    onSuccess: () => {
      setEditingId(null);
      setEditError(null);
      queryClient.invalidateQueries({ queryKey: ['admin_profiles'] });
      queryClient.invalidateQueries({ queryKey: ['admin_audit_logs'] });
    },
    onError: (err: Error) => setEditError(err.message),
  });

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreateSuccess(null);
    createUserMutation.mutate();
  };

  // Загрузка пользователей
  const { data: profiles = [], isLoading: loadingProfiles } = useQuery({
    queryKey: ['admin_profiles'],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as Profile[];
    },
  });

  // Предметы и назначение предметов пользователям
  const { data: allSubjects = [] } = useQuery({
    queryKey: ['admin_subject_list'],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.from('subjects').select('id, name').eq('is_deleted', false).order('name');
      if (error) throw error;
      return (data || []) as Array<{ id: string; name: string }>;
    },
  });
  const { data: assignments = [] } = useQuery({
    queryKey: ['admin_user_subjects'],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.from('user_subjects').select('user_id, subject_id');
      if (error) throw error;
      return (data || []) as Array<{ user_id: string; subject_id: string }>;
    },
  });
  const subjectsOf = (userId: string) => assignments.filter((a) => a.user_id === userId).map((a) => a.subject_id);

  // Загрузка журнала аудита
  const { data: logs = [], isLoading: loadingLogs } = useQuery({
    queryKey: ['admin_audit_logs'],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(20);
      if (error) throw error;
      return (data || []) as AuditLog[];
    },
  });

  // Смена роли пользователя (преподаватель <-> администратор)
  const changeRoleMutation = useMutation({
    mutationFn: async ({ userId, newRole }: { userId: string; newRole: UserRole }) => {
      const { data: changed, error } = await supabase
        .from('profiles')
        .update({ role: newRole })
        .eq('id', userId)
        .select('id');
      if (error) throw error;
      assertRowsChanged(changed, 'роль пользователя');
      // Запись в журнал аудита делает сама база (триггер на смену роли)
    },
    meta: { action: 'Не удалось изменить роль', success: 'Роль пользователя изменена в базе' },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin_profiles'] });
      queryClient.invalidateQueries({ queryKey: ['admin_audit_logs'] });
    },
  });

  // Роль и предметы (только главный админ)
  const [rolesEditId, setRolesEditId] = useState<string | null>(null);
  const [rolesEditRole, setRolesEditRole] = useState<UserRole>('user');
  const [rolesEditSubjects, setRolesEditSubjects] = useState<string[]>([]);
  const startRolesEdit = (p: Profile) => {
    setRolesEditId(p.id);
    setRolesEditRole(p.role);
    setRolesEditSubjects(subjectsOf(p.id));
  };
  const saveRolesMutation = useMutation({
    mutationFn: async (userId: string) => {
      if (isSubjectRole(rolesEditRole) && !rolesEditSubjects.length) throw new Error('Выберите хотя бы один предмет');
      const { data: changed, error } = await supabase.from('profiles').update({ role: rolesEditRole }).eq('id', userId).select('id');
      if (error) throw error;
      assertRowsChanged(changed, 'роль пользователя');
      const del = await supabase.from('user_subjects').delete().eq('user_id', userId);
      if (del.error) throw del.error;
      if (isSubjectRole(rolesEditRole)) {
        const ins = await supabase.from('user_subjects').insert(rolesEditSubjects.map((subject_id) => ({ user_id: userId, subject_id })));
        if (ins.error) throw ins.error;
      }
    },
    meta: { action: 'Не удалось сохранить роль и предметы', success: 'Роль и предметы сохранены в базе' },
    onSuccess: () => {
      setRolesEditId(null);
      queryClient.invalidateQueries({ queryKey: ['admin_profiles'] });
      queryClient.invalidateQueries({ queryKey: ['admin_user_subjects'] });
      queryClient.invalidateQueries({ queryKey: ['admin_audit_logs'] });
    },
  });

  // Данные админов (и главного) меняет только главный админ; свои — каждый
  const canEdit = (p: Profile) => isOwner || p.id === currentUser?.id || (p.role !== 'admin' && !p.is_owner);

  // Удаление пользователя (только главный админ)
  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('Сессия не найдена, войдите заново');
      const { data, error } = await supabase.functions.invoke('admin-delete-user', {
        body: { userId },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (error) throw new Error(await functionErrorMessage(error));
      if (data?.error) throw new Error(data.error);
      return data;
    },
    meta: { action: 'Не удалось удалить пользователя', success: 'Пользователь удалён' },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin_profiles'] });
      queryClient.invalidateQueries({ queryKey: ['admin_user_subjects'] });
      queryClient.invalidateQueries({ queryKey: ['admin_audit_logs'] });
    },
  });

  if (!isAdmin) {
    return (
      <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center text-sm text-slate-500">
        У вас нет прав администратора для просмотра этого раздела.
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Пользователи */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center">
            <Users className="w-5 h-5 mr-2 text-blue-600" />
            Управление пользователями и ролями
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Роли: преподаватель, администратор и роли по предметам (доступ только к назначенным предметам).
            Роли, данные администраторов и удаление пользователей — только у главного админа.
            Пароль, заданный здесь, временный: при входе человек заменит его на свой.
          </p>
        </div>

        <form onSubmit={handleCreateUser} className="border border-slate-200 rounded-xl p-4 bg-slate-50 space-y-3">
          <div className="text-sm font-semibold text-slate-800 flex items-center">
            <UserPlus className="w-4 h-4 mr-2 text-blue-600" />
            Создать новый аккаунт
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="email"
              required
              placeholder="Email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
            <input
              type="password"
              required
              minLength={6}
              placeholder="Временный пароль (мин. 6 символов)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
            <input
              type="text"
              placeholder="Имя (необязательно)"
              value={newFullName}
              onChange={(e) => setNewFullName(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as UserRole)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
            >
              <option value="user">{ROLE_LABELS.user}</option>
              {isOwner && <option value="admin">{ROLE_LABELS.admin}</option>}
              {isOwner && <option value="subject_teacher">{ROLE_LABELS.subject_teacher}</option>}
              {isOwner && <option value="subject_admin">{ROLE_LABELS.subject_admin}</option>}
            </select>
          </div>
          {isSubjectRole(newRole) && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-slate-600">Доступные предметы</div>
              <SubjectPicker subjects={allSubjects} value={newSubjectIds} onChange={setNewSubjectIds} />
            </div>
          )}

          {createError && <div className="text-xs text-red-600">{createError}</div>}
          {createSuccess && <div className="text-xs text-emerald-600">{createSuccess}</div>}

          <button
            type="submit"
            disabled={createUserMutation.isPending}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold text-sm flex items-center space-x-2 disabled:opacity-50"
          >
            {createUserMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <UserPlus className="w-4 h-4" />
            )}
            <span>Создать аккаунт</span>
          </button>
        </form>

        {loadingProfiles ? (
          <div className="text-center py-6 text-slate-500 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Загрузка пользователей...
          </div>
        ) : (
          <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 text-xs">
            {profiles.map((p) => (
              <div key={p.id} className="bg-white">
              <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-900 text-sm flex items-center space-x-2">
                    <span>{p.full_name || p.email}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${
                      p.role === 'admin' || p.role === 'subject_admin' ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-slate-100 text-slate-700'
                    }`}>
                      {p.is_owner ? 'Главный админ' : ROLE_LABELS[p.role]}
                    </span>
                  </div>
                  {isSubjectRole(p.role) && (
                    <div className="flex flex-wrap items-center gap-1 mt-1">
                      <BookMarked className="w-3 h-3 text-emerald-600" />
                      {subjectsOf(p.id).length === 0 ? (
                        <span className="text-xs text-red-500">предметы не назначены</span>
                      ) : (
                        subjectsOf(p.id).map((sid) => (
                          <span key={sid} className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
                            {allSubjects.find((x) => x.id === sid)?.name ?? '—'}
                          </span>
                        ))
                      )}
                    </div>
                  )}
                  <div className="text-xs text-slate-500 mt-0.5">
                    Email: {p.email} • Зарегистрирован: {new Date(p.created_at).toLocaleDateString('ru-RU')}
                  </div>
                </div>

                <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                  {canEdit(p) && (
                  <button
                    onClick={() => (editingId === p.id ? setEditingId(null) : startEdit(p))}
                    className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 rounded-lg font-semibold flex items-center space-x-1"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>Изменить</span>
                  </button>
                  )}
                  {isOwner && p.role === 'user' && (
                    <button
                      onClick={() => changeRoleMutation.mutate({ userId: p.id, newRole: 'admin' })}
                      disabled={changeRoleMutation.isPending}
                      className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg font-semibold flex items-center space-x-1"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Сделать админом</span>
                    </button>
                  )}
                  {isOwner && p.role === 'admin' && !p.is_owner && (
                    <button
                      onClick={() => changeRoleMutation.mutate({ userId: p.id, newRole: 'user' })}
                      disabled={p.id === currentUser?.id || changeRoleMutation.isPending}
                      className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg font-semibold flex items-center space-x-1 disabled:opacity-40"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>Сделать преподавателем</span>
                    </button>
                  )}
                  {isOwner && !p.is_owner && (
                    <button
                      onClick={() => (rolesEditId === p.id ? setRolesEditId(null) : startRolesEdit(p))}
                      className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg font-semibold flex items-center space-x-1"
                    >
                      <BookMarked className="w-3.5 h-3.5" />
                      <span>Роль и предметы</span>
                    </button>
                  )}
                  {isOwner && !p.is_owner && p.id !== currentUser?.id && (
                    <button
                      onClick={() => {
                        if (confirm(`Удалить пользователя ${p.full_name || p.email}? Его вопросы и билеты останутся, войти он больше не сможет.`)) {
                          deleteUserMutation.mutate(p.id);
                        }
                      }}
                      disabled={deleteUserMutation.isPending}
                      className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-40"
                      title="Удалить пользователя"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
              {rolesEditId === p.id && (
                <div className="px-4 pb-4 space-y-3">
                  <select
                    value={rolesEditRole}
                    onChange={(e) => setRolesEditRole(e.target.value as UserRole)}
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  >
                    {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
                      <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                    ))}
                  </select>
                  {isSubjectRole(rolesEditRole) && (
                    <div className="space-y-1.5">
                      <div className="text-xs font-semibold text-slate-600">Доступные предметы</div>
                      <SubjectPicker subjects={allSubjects} value={rolesEditSubjects} onChange={setRolesEditSubjects} />
                    </div>
                  )}
                  <div className="flex space-x-2">
                    <button
                      type="button"
                      onClick={() => saveRolesMutation.mutate(p.id)}
                      disabled={saveRolesMutation.isPending}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold text-sm disabled:opacity-50"
                    >
                      Сохранить
                    </button>
                    <button
                      type="button"
                      onClick={() => setRolesEditId(null)}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold text-sm"
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              )}
              {editingId === p.id && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    setEditError(null);
                    updateUserMutation.mutate(p.id);
                  }}
                  className="px-4 pb-4 space-y-3"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <input
                      type="text"
                      placeholder="Имя"
                      value={editFullName}
                      onChange={(e) => setEditFullName(e.target.value)}
                      className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                    <input
                      type="email"
                      required
                      placeholder="Email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                    <input
                      type="password"
                      minLength={6}
                      placeholder={p.id === currentUser?.id ? 'Новый пароль (пусто — не менять)' : 'Временный пароль (пусто — не менять)'}
                      value={editPassword}
                      onChange={(e) => setEditPassword(e.target.value)}
                      className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                  </div>
                  {editError && <div className="text-xs text-red-600">{editError}</div>}
                  <div className="flex space-x-2">
                    <button
                      type="submit"
                      disabled={updateUserMutation.isPending}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold text-sm disabled:opacity-50"
                    >
                      Сохранить
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold text-sm"
                    >
                      Отмена
                    </button>
                  </div>
                </form>
              )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Журнал аудита действий */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div>
          <h3 className="font-bold text-slate-900 text-base flex items-center">
            <Activity className="w-4 h-4 mr-2 text-indigo-600" />
            Журнал действий системы (Аудит)
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Последние изменения и события в системе
          </p>
        </div>

        {loadingLogs ? (
          <div className="text-center py-4 text-slate-500">Загрузка журнала...</div>
        ) : logs.length === 0 ? (
          <div className="text-center py-6 text-xs text-slate-500">Событий пока не зафиксировано.</div>
        ) : (
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden text-xs">
            {logs.map((log) => (
              <div key={log.id} className="p-3 flex items-center justify-between bg-white hover:bg-slate-50">
                <div>
                  <span className="font-bold text-indigo-700 font-mono mr-2">{log.action}</span>
                  <span className="text-slate-600">[{log.entity_type}]</span>
                  {log.details && (
                    <span className="text-slate-500 ml-2 font-mono text-xs">
                      {JSON.stringify(log.details)}
                    </span>
                  )}
                </div>
                <span className="text-xs text-slate-500">
                  {new Date(log.created_at).toLocaleString('ru-RU')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
