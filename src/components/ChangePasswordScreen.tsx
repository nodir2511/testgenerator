import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { passwordErrorText } from '../lib/errors';
import { passwordChecks, passwordOk } from '../lib/passwordRules';
import { CheckCircle2, Circle, Eye, EyeOff, KeyRound, Loader2, LogOut } from 'lucide-react';

// Обязательная смена пароля: пароль задал администратор, значит его знает не только владелец аккаунта.
// Пока пароль не сменён, остальная часть сайта недоступна. Флаг в профиле база снимает сама,
// как только меняется пароль (supabase/sql/security_round3.sql).
export const ChangePasswordScreen: React.FC = () => {
  const { profile, user, refreshProfile, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const checks = passwordChecks(password);
  const same = password.length > 0 && password === repeat;
  const canSave = passwordOk(password) && same && !saving;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setError(null);
    setSaving(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) throw err;
      await refreshProfile();
    } catch (err) {
      setError(passwordErrorText(err));
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full min-h-[48px] px-3 pr-12 text-base border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent';

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-50">
      <div className="min-h-full flex flex-col items-center justify-center px-4 py-8">
        <div className="bg-white rounded-2xl shadow-xl max-w-md w-full border border-slate-200">
          <div className="p-5 sm:p-6 border-b border-slate-100 flex items-start gap-3">
            <div className="w-11 h-11 shrink-0 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">Придумайте свой пароль</h1>
              <p className="text-sm text-slate-600 mt-1">
                Пароль для входа задал администратор. Чтобы аккаунтом пользовались только вы, замените его на свой.
              </p>
            </div>
          </div>

          <form onSubmit={submit} className="p-5 sm:p-6 space-y-4">
            <div className="text-sm text-slate-600">
              Аккаунт: <span className="font-semibold text-slate-900">{profile?.email || user?.email}</span>
            </div>

            <label className="block">
              <span className="block text-sm font-semibold text-slate-700 mb-1.5">Новый пароль</span>
              <div className="relative">
                <input
                  type={show ? 'text' : 'password'}
                  autoComplete="new-password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputCls}
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-slate-500 hover:text-slate-800"
                  aria-label={show ? 'Скрыть пароль' : 'Показать пароль'}
                >
                  {show ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </label>

            <ul className="space-y-1.5">
              {checks.map((c) => (
                <li key={c.label} className={`flex items-center gap-2 text-sm ${c.ok ? 'text-emerald-700' : 'text-slate-600'}`}>
                  {c.ok ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                  {c.label}
                </li>
              ))}
            </ul>

            <label className="block">
              <span className="block text-sm font-semibold text-slate-700 mb-1.5">Повторите пароль</span>
              <input
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                className={inputCls}
              />
              {repeat.length > 0 && !same && <span className="block text-sm text-red-600 mt-1.5">Пароли не совпадают</span>}
            </label>

            {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>}

            <button
              type="submit"
              disabled={!canSave}
              className="w-full min-h-[52px] bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-base flex items-center justify-center gap-2 transition disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <KeyRound className="w-5 h-5" />}
              {saving ? 'Сохраняем…' : 'Сохранить пароль'}
            </button>

            <button
              type="button"
              onClick={() => signOut()}
              className="w-full min-h-[44px] text-sm font-semibold text-slate-600 hover:text-slate-900 flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Выйти
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
