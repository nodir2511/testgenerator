import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { Profile, UserRole } from '../types/database';

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  isLoading: boolean;
  /** Полный администратор (все предметы) */
  isAdmin: boolean;
  /** Главный администратор */
  isOwner: boolean;
  /** Администратор любого уровня (полный или по предметам) */
  isStaff: boolean;
  /** Назначенные предметы для ролей «по предметам»; null — доступны все */
  subjectIds: string[] | null;
  /** Можно ли редактировать содержимое предмета */
  canManage: (subjectId: string | null | undefined) => boolean;
  signIn: (email: string, pass: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [assigned, setAssigned] = useState<string[]>([]);

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        console.error('Ошибка загрузки профиля:', error.message);
        return null;
      }
      return data as Profile;
    } catch (err) {
      console.error('Сбой получения профиля:', err);
      return null;
    }
  };

  // Предметы «по предметам» читаются одновременно с профилем (роль заранее не нужна): так нет второго круга запросов
  const fetchAssigned = async (userId: string): Promise<string[]> => {
    try {
      const { data } = await supabase.from('user_subjects').select('subject_id').eq('user_id', userId);
      return (data || []).map((r: any) => r.subject_id);
    } catch {
      return [];
    }
  };

  const loadAccount = async (userId: string) => {
    const [p, subjects] = await Promise.all([fetchProfile(userId), fetchAssigned(userId)]);
    setProfile(p);
    setAssigned(subjects);
  };

  const refreshProfile = async () => {
    if (user) await loadAccount(user.id);
  };

  // Пользователь, чей профиль уже загружен: повторные события (первая сессия, обновление токена) профиль не перечитывают
  const loadedUserId = React.useRef<string | null>(null);

  useEffect(() => {
    // 1. Получаем текущую сессию
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        loadedUserId.current = session.user.id;
        loadAccount(session.user.id).then(() => setIsLoading(false));
      } else {
        setIsLoading(false);
      }
    });

    // 2. Подписываемся на изменения авторизации
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          const same = loadedUserId.current === session.user.id;
          // Первая сессия уже обработана выше; обновление токена не меняет профиль
          if (event === 'INITIAL_SESSION' || (event === 'TOKEN_REFRESHED' && same)) return;
          loadedUserId.current = session.user.id;
          await loadAccount(session.user.id);
        } else {
          loadedUserId.current = null;
          setProfile(null);
          setAssigned([]);
        }
        setIsLoading(false);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, pass: string) => {
    setIsLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: pass,
    });
    setIsLoading(false);
    return { error: error ? new Error(error.message) : null };
  };

  const signOut = async () => {
    setIsLoading(true);
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setSession(null);
    setIsLoading(false);
  };

  const isAdmin = profile?.role === 'admin';
  const isOwner = isAdmin && profile?.is_owner === true;
  const isSubjectAdmin = profile?.role === 'subject_admin';
  const bySubject = isSubjectAdmin || profile?.role === 'subject_teacher';
  const isStaff = isAdmin || isSubjectAdmin;
  const subjectIds = bySubject ? assigned : null;
  const canManage = (subjectId: string | null | undefined) => isAdmin || (isSubjectAdmin && !!subjectId && assigned.includes(subjectId));

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        session,
        isLoading,
        isAdmin,
        isOwner,
        isStaff,
        subjectIds,
        canManage,
        signIn,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth должен использоваться внутри AuthProvider');
  }
  return context;
};
