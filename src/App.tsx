import React, { useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { isSupabaseConfigured } from './lib/supabase';
import { TaxonomyManager } from './components/TaxonomyManager';
import { QuestionList } from './components/QuestionList';
import { QuestionForm } from './components/QuestionForm';
import { TicketGenerator } from './components/TicketGenerator';
import { SavedTicketsView } from './components/SavedTicketsView';
import { BulkImport } from './components/BulkImport';
import { UserManagementView } from './components/UserManagementView';
import { AuthModal } from './components/AuthModal';
import { Question } from './types/database';
import { 
  BookOpen, 
  Layers, 
  FileCheck2, 
  Sparkles, 
  Upload, 
  Users, 
  LogIn, 
  LogOut, 
  ShieldCheck, 
  User as UserIcon,
  Menu,
  X,
  FileQuestion
} from 'lucide-react';

type TabType = 'questions' | 'taxonomy' | 'generator' | 'saved_tickets' | 'bulk_import' | 'users';

export const App: React.FC = () => {
  const { user, profile, isAdmin, signOut, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('questions');
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Состояние формы редактирования/добавления вопроса
  const [isQuestionFormOpen, setIsQuestionFormOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);

  // Навигационные ссылки
  const navItems = [
    { id: 'questions', label: 'Банк вопросов', icon: FileQuestion },
    { id: 'taxonomy', label: 'Предметы и темы', icon: Layers },
    { id: 'generator', label: 'Генератор билетов', icon: Sparkles },
    { id: 'saved_tickets', label: 'Сохраненные билеты', icon: FileCheck2 },
    { id: 'bulk_import', label: 'Массовый импорт', icon: Upload },
    ...(isAdmin ? [{ id: 'users', label: 'Пользователи и аудит', icon: Users }] : []),
  ];

  const handleAddQuestion = () => {
    setEditingQuestion(null);
    setIsQuestionFormOpen(true);
  };

  const handleEditQuestion = (q: Question) => {
    setEditingQuestion(q);
    setIsQuestionFormOpen(true);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans text-slate-900">
      {/* Главный заголовок */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Логотип */}
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setActiveTab('questions')}>
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-bold text-base sm:text-lg text-slate-900 leading-tight">
                Экзаменатор
              </h1>
              <p className="text-[11px] text-slate-400 font-medium">Банк вопросов и генератор билетов</p>
            </div>
          </div>

          {/* Десктоп-меню пользователя */}
          <div className="hidden md:flex items-center space-x-3">
            {user ? (
              <div className="flex items-center space-x-3 bg-slate-100/80 px-3 py-1.5 rounded-xl border border-slate-200">
                <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
                  <UserIcon className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <div className="text-xs font-bold text-slate-800 leading-tight">
                    {profile?.full_name || user.email?.split('@')[0]}
                  </div>
                  <div className="text-[10px] text-slate-500 flex items-center font-semibold">
                    {isAdmin ? (
                      <span className="text-amber-700 flex items-center">
                        <ShieldCheck className="w-3 h-3 mr-0.5" /> Главный админ
                      </span>
                    ) : (
                      'Преподаватель'
                    )}
                  </div>
                </div>
                <button
                  onClick={() => signOut()}
                  className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg transition"
                  title="Выйти"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsAuthModalOpen(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow transition flex items-center space-x-1.5"
              >
                <LogIn className="w-4 h-4" />
                <span>Войти / Регистрация</span>
              </button>
            )}
          </div>

          {/* Мобильная кнопка бургера */}
          <div className="md:hidden flex items-center space-x-2">
            {!user && (
              <button
                onClick={() => setIsAuthModalOpen(true)}
                className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg"
              >
                Войти
              </button>
            )}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* Навигационная панель табов (десктоп) */}
        <div className="hidden md:block bg-white border-t border-slate-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex space-x-1 overflow-x-auto">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id as TabType);
                    setIsQuestionFormOpen(false);
                  }}
                  className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center space-x-2 whitespace-nowrap transition-all ${
                    isActive
                      ? 'border-blue-600 text-blue-600 bg-blue-50/40'
                      : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Мобильное выпадающее меню */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-white border-b border-slate-200 px-4 pt-2 pb-4 space-y-1 shadow-lg">
            {user && (
              <div className="p-3 bg-slate-50 rounded-xl mb-3 flex items-center justify-between">
                <div>
                  <div className="font-bold text-xs text-slate-900">{profile?.full_name || user.email}</div>
                  <div className="text-[10px] text-slate-500">{isAdmin ? 'Администратор' : 'Преподаватель'}</div>
                </div>
                <button
                  onClick={() => signOut()}
                  className="text-xs text-red-600 font-semibold"
                >
                  Выйти
                </button>
              </div>
            )}
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id as TabType);
                    setIsQuestionFormOpen(false);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full text-left py-2.5 px-3 rounded-xl text-xs font-semibold flex items-center space-x-2 ${
                    isActive ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </header>

      {/* Основной контент */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Экран формы создания / редактирования вопроса */}
        {isQuestionFormOpen ? (
          <QuestionForm
            initialData={editingQuestion}
            onSuccess={() => {
              setIsQuestionFormOpen(false);
              setEditingQuestion(null);
            }}
            onCancel={() => {
              setIsQuestionFormOpen(false);
              setEditingQuestion(null);
            }}
          />
        ) : (
          <>
            {activeTab === 'questions' && (
              <QuestionList
                onAddQuestion={handleAddQuestion}
                onEditQuestion={handleEditQuestion}
              />
            )}
            {activeTab === 'taxonomy' && <TaxonomyManager />}
            {activeTab === 'generator' && <TicketGenerator />}
            {activeTab === 'saved_tickets' && <SavedTicketsView />}
            {activeTab === 'bulk_import' && (
              <BulkImport onSuccess={() => setActiveTab('questions')} />
            )}
            {activeTab === 'users' && <UserManagementView />}
          </>
        )}
      </main>

      {/* Футер */}
      <footer className="bg-white border-t border-slate-200 py-4 text-center text-xs text-slate-400">
        Система экзаменационных билетов • Десктопная и мобильная версии • Supabase RLS
      </footer>

      {/* Модальное окно авторизации */}
      <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
    </div>
  );
};

export default App;
