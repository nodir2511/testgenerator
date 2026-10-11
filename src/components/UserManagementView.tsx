import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Profile, UserRole, AuditLog } from '../types/database';
import { useAuth } from '../hooks/useAuth';
import { Users, Shield, ShieldCheck, UserCheck, Activity, Loader2 } from 'lucide-react';

export const UserManagementView: React.FC = () => {
  const queryClient = useQueryClient();
  const { user: currentUser, isAdmin } = useAuth();

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

        {loadingProfiles ? (
          <div className="text-center py-6 text-slate-400 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Загрузка пользователей...
          </div>
        ) : (
          <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 text-xs">
            {profiles.map((p) => (
              <div key={p.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white">
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
