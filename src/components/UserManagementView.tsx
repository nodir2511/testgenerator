import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Profile, UserRole, AuditLog } from '../types/database';
import { useAuth } from '../hooks/useAuth';
import { Users, ShieldCheck, UserCheck, Activity, Loader2, UserPlus, Pencil } from 'lucide-react';

export const UserManagementView: React.FC = () => {
  const queryClient = useQueryClient();
  const { user: currentUser, isAdmin } = useAuth();

  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('user');
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  // Создание нового аккаунта администратором
  const createUserMutation = useMutation({
    mutationFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error('Сессия не найдена, войдите заново');

      const { data, error } = await supabase.functions.invoke('admin-create-user', {
        body: { email: newEmail.trim(), password: newPassword, fullName: newFullName.trim(), role: newRole },
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      setCreateError(null);
      setCreateSuccess(`Аккаунт ${data.email} создан`);
      setNewEmail('');
      setNewPassword('');
      setNewFullName('');
      setNewRole('user');
      queryClient.invalidateQueries({ queryKey: ['admin_profiles'] });
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

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data;
    },
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

  // Смена роли пользователя
  const changeRoleMutation = useMutation({
    mutationFn: async ({ userId, newRole }: { userId: string; newRole: UserRole }) => {
      const { error } = await supabase
        .from('profiles')
        .update({ role: newRole })
        .eq('id', userId);
      if (error) throw error;

      await supabase.from('audit_logs').insert({
        user_id: currentUser?.id,
        action: 'CHANGE_USER_ROLE',
        entity_type: 'profiles',
        entity_id: userId,
        details: { new_role: newRole },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin_profiles'] });
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
            Назначение ролей «Преподаватель» (обычный пользователь) и «Администратор»
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
              placeholder="Пароль (мин. 6 символов)"
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
              <option value="user">Преподаватель</option>
              <option value="admin">Администратор</option>
            </select>
          </div>

          {createError && <div className="text-xs text-red-600">{createError}</div>}
          {createSuccess && <div className="text-xs text-emerald-600">{createSuccess}</div>}

          <button
            type="submit"
            disabled={createUserMutation.isPending}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm flex items-center space-x-2 disabled:opacity-50"
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
          <div className="text-center py-6 text-slate-400 flex items-center justify-center">
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
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      p.role === 'admin' ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-slate-100 text-slate-700'
                    }`}>
                      {p.role === 'admin' ? 'Администратор' : 'Преподаватель'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Email: {p.email} • Зарегистрирован: {new Date(p.created_at).toLocaleDateString('ru-RU')}
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => (editingId === p.id ? setEditingId(null) : startEdit(p))}
                    className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 rounded-lg font-semibold flex items-center space-x-1"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>Изменить</span>
                  </button>
                  {p.role === 'user' ? (
                    <button
                      onClick={() => changeRoleMutation.mutate({ userId: p.id, newRole: 'admin' })}
                      disabled={changeRoleMutation.isPending}
                      className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg font-semibold flex items-center space-x-1"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Сделать админом</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => changeRoleMutation.mutate({ userId: p.id, newRole: 'user' })}
                      disabled={p.id === currentUser?.id || changeRoleMutation.isPending}
                      className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg font-semibold flex items-center space-x-1 disabled:opacity-40"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>Сделать преподавателем</span>
                    </button>
                  )}
                </div>
              </div>
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
                      placeholder="Новый пароль (пусто — не менять)"
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
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm disabled:opacity-50"
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
          <div className="text-center py-4 text-slate-400">Загрузка журнала...</div>
        ) : logs.length === 0 ? (
          <div className="text-center py-6 text-xs text-slate-400">Событий пока не зафиксировано.</div>
        ) : (
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden text-xs">
            {logs.map((log) => (
              <div key={log.id} className="p-3 flex items-center justify-between bg-white hover:bg-slate-50">
                <div>
                  <span className="font-bold text-indigo-700 font-mono mr-2">{log.action}</span>
                  <span className="text-slate-600">[{log.entity_type}]</span>
                  {log.details && (
                    <span className="text-slate-400 ml-2 font-mono text-[10px]">
                      {JSON.stringify(log.details)}
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-slate-400">
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
