import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { authErrorText } from '../lib/errors';
import { LogIn, ShieldAlert, Lock, Mail, Eye, EyeOff, Loader2, Sparkles } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose?: () => void;
}

// Telegram администратора для восстановления доступа (необязательно): VITE_SUPPORT_TELEGRAM=username
const SUPPORT_TG = (import.meta.env.VITE_SUPPORT_TELEGRAM as string | undefined)?.replace(/^@/, '');

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const { signIn } = useAuth();
  const [email, setEmail] = useState(() => localStorage.getItem('examiner_last_email') || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);
    try {
      const res = await signIn(email.trim(), password);
      if (res.error) {
        setErrorMsg(authErrorText(res.error));
      } else {
        localStorage.setItem('examiner_last_email', email.trim());
        onClose?.();
      }
    } catch (err) {
      setErrorMsg(authErrorText(err));
    } finally {
      setLoading(false);
    }
  };

  const inputCls = 'w-full min-h-[48px] pl-10 text-base border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent';

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-50">
      <div className="min-h-full flex flex-col items-center justify-center px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-indigo-600 via-blue-600 to-indigo-500 text-white flex items-center justify-center shadow-md shadow-indigo-500/20">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="font-bold text-lg text-slate-900 leading-tight">Экзаменатор</div>
            <div className="text-sm text-slate-600">Банк вопросов и генератор билетов</div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-xl max-w-md w-full border border-slate-200">
          <div className="p-5 sm:p-6 border-b border-slate-100">
            <h2 className="text-xl font-bold text-slate-900">Вход</h2>
            <p className="text-sm text-slate-600 mt-1">Аккаунты создаёт администратор. Введите почту и пароль, которые он вам выдал.</p>
          </div>

          <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-4">
            {errorMsg && (
              <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-sm text-red-800">
                <ShieldAlert className="w-5 h-5 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <label className="block">
              <span className="block text-sm font-semibold text-slate-800 mb-1">Электронная почта</span>
              <span className="relative block">
                <Mail className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  autoComplete="username"
                  inputMode="email"
                  autoCapitalize="none"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="teacher@school.tj"
                  className={`${inputCls} pr-3`}
                />
              </span>
            </label>

            <label className="block">
              <span className="block text-sm font-semibold text-slate-800 mb-1">Пароль</span>
              <span className="relative block">
                <Lock className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Минимум 6 символов"
                  className={`${inputCls} pr-12`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-slate-500 hover:text-slate-800"
                  aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </span>
            </label>

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[52px] px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-70 text-white font-bold rounded-xl text-base shadow-sm transition flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <LogIn className="w-5 h-5" />}
              <span>{loading ? 'Входим…' : 'Войти'}</span>
            </button>

            <div className="text-center">
              <button type="button" onClick={() => setShowForgot((v) => !v)} className="min-h-[40px] text-sm font-semibold text-indigo-700">
                Забыли пароль?
              </button>
              {showForgot && (
                <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-3 mt-1">
                  Пароль меняет администратор.{' '}
                  {SUPPORT_TG ? (
                    <>Напишите ему в Telegram: <a href={`https://t.me/${SUPPORT_TG}`} target="_blank" rel="noreferrer" className="font-semibold text-indigo-700 underline">@{SUPPORT_TG}</a></>
                  ) : (
                    'Напишите администратору, который выдал вам доступ, — он задаст новый пароль.'
                  )}
                </p>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
