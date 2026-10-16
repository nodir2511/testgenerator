import React, { Suspense, lazy, useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { isSupabaseConfigured } from './lib/supabase';
// Тяжёлые разделы грузятся по требованию — сайт открывается быстрее
const TaxonomyManager = lazy(() => import('./components/TaxonomyManager').then((m) => ({ default: m.TaxonomyManager })));
const QuestionList = lazy(() => import('./components/QuestionList').then((m) => ({ default: m.QuestionList })));
const QuestionForm = lazy(() => import('./components/QuestionForm').then((m) => ({ default: m.QuestionForm })));
const TicketGenerator = lazy(() => import('./components/TicketGenerator').then((m) => ({ default: m.TicketGenerator })));
const SavedTicketsView = lazy(() => import('./components/SavedTicketsView').then((m) => ({ default: m.SavedTicketsView })));
const BulkImport = lazy(() => import('./components/BulkImport').then((m) => ({ default: m.BulkImport })));
const UserManagementView = lazy(() => import('./components/UserManagementView').then((m) => ({ default: m.UserManagementView })));
const ClusterExam = lazy(() => import('./components/ClusterExam').then((m) => ({ default: m.ClusterExam })));
const ReleasesView = lazy(() => import('./components/ReleasesView').then((m) => ({ default: m.ReleasesView })));
const StatsView = lazy(() => import('./components/StatsView').then((m) => ({ default: m.StatsView })));
import { AuthModal } from './components/AuthModal';
import { TelegramLink } from './components/TelegramLink';
import { WhatsNewModal } from './components/WhatsNewModal';
import { useReleases } from './hooks/useReleases';
import { Question, ROLE_LABELS } from './types/database';
import { 
  BookOpen, 
  Layers, 
  FileCheck2, 
  Sparkles, 
  Upload,
  Users,
  LogOut,
  ShieldCheck,
  User as UserIcon,
  Menu,
  BarChart3,
  Bell,
  Gamepad2,
  X,
  FileQuestion,
  Loader2,
  CheckCircle2
} from 'lucide-react';

type TabType = 'questions' | 'taxonomy' | 'generator' | 'saved_tickets' | 'bulk_import' | 'users' | 'stats' | 'cluster' | 'releases';

export const App: React.FC = () => {
  const { user, profile, isAdmin, isOwner, isStaff, signOut, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    const saved = localStorage.getItem('examiner_active_tab');
    const validTabs: TabType[] = ['questions', 'taxonomy', 'generator', 'saved_tickets', 'bulk_import', 'users', 'stats', 'cluster', 'releases'];
    return (validTabs.includes(saved as TabType)) ? (saved as TabType) : 'generator';
  });
  const adminOnlyTabs: TabType[] = ['users', 'stats'];
  const staffOnlyTabs: TabType[] = ['taxonomy', 'bulk_import'];
  const ownerOnlyTabs: TabType[] = ['cluster'];
  const currentTab: TabType = (!isAdmin && adminOnlyTabs.includes(activeTab)) || (!isStaff && staffOnlyTabs.includes(activeTab)) || (!isOwner && ownerOnlyTabs.includes(activeTab)) ? 'generator' : activeTab;

  React.useEffect(() => {
    localStorage.setItem('examiner_active_tab', activeTab);
  }, [activeTab]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Состояние формы редактирования/добавления вопроса
  const [isQuestionFormOpen, setIsQuestionFormOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);

  // Всплывающее подтверждение сохранения
  const [saveToast, setSaveToast] = useState<string | null>(null);
  React.useEffect(() => {
    if (!saveToast) return;
    const timer = setTimeout(() => setSaveToast(null), 2500);
    return () => clearTimeout(timer);
  }, [saveToast]);

  // Обновления сайта: окно «Что нового» при входе, пока есть непрочитанные версии
  const { unread, markRead } = useReleases();
  const [newsDismissed, setNewsDismissed] = useState(false);
  const showNews = !!user && !newsDismissed && unread.length > 0 && currentTab !== 'releases';
  const closeNews = () => {
    setNewsDismissed(true);
    markRead(unread.map((r) => r.id));
  };
  const openReleases = () => {
    setActiveTab('releases');
    setIsQuestionFormOpen(false);
    setMobileMenuOpen(false);
  };

  // Навигационные ссылки
  const navItems = [
    { id: 'questions', label: 'Банк вопросов', icon: FileQuestion },
    ...(isStaff ? [{ id: 'taxonomy', label: 'Предметы и темы', icon: Layers }] : []),
    { id: 'generator', label: 'Генератор билетов', icon: Sparkles },
    { id: 'saved_tickets', label: 'Сохраненные билеты', icon: FileCheck2 },
    ...(isStaff ? [{ id: 'bulk_import', label: 'Массовый импорт', icon: Upload }] : []),
    ...(isOwner ? [{ id: 'cluster', label: 'Экзамен-кластер', icon: BookOpen }] : []),
    ...(isAdmin ? [{ id: 'admin', label: 'Администрирование', icon: Users }] : []),
    ...(isOwner ? [{ id: 'game', label: 'Своя игра', icon: Gamepad2 }] : []),
  ];
  const isAdminSection = currentTab === 'users' || currentTab === 'stats';

  const handleAddQuestion = () => {
    setEditingQuestion(null);
    setIsQuestionFormOpen(true);
  };

  const handleEditQuestion = (q: Question) => {
    setEditingQuestion(q);
    setIsQuestionFormOpen(true);
  };

  // Пока идёт проверка сессии — показываем загрузку, не раскрывая содержимое
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  // Неавторизованным пользователям сайт полностью недоступен — только форма входа
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50">
        <AuthModal isOpen={true} />
      </div>
    );
  }

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
            <div className="flex items-center space-x-3 bg-slate-100/80 px-3 py-1.5 rounded-xl border border-slate-200">
              <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
                <UserIcon className="w-4 h-4" />
              </div>
              <div className="text-left">
                <div className="text-xs font-bold text-slate-800 leading-tight">
                  {profile?.full_name || user.email?.split('@')[0]}
                </div>
                <div className="text-[10px] text-slate-500 flex items-center font-semibold">
                  {isStaff ? (
                    <span className="text-amber-700 flex items-center">
                      <ShieldCheck className="w-3 h-3 mr-0.5" /> {isOwner ? 'Главный админ' : ROLE_LABELS[profile?.role ?? 'admin']}
                    </span>
                  ) : (
                    ROLE_LABELS[profile?.role ?? 'user']
                  )}
                </div>
              </div>
              <TelegramLink />
              <button onClick={openReleases} className="relative p-1.5 text-slate-400 hover:text-blue-600 rounded-lg transition" title="Что нового" aria-label="Что нового">
                <Bell className="w-4 h-4" />
                {unread.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-red-600 text-white text-[9px] font-bold flex items-center justify-center">{unread.length}</span>
                )}
              </button>
              <button
                onClick={() => signOut()}
                className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg transition"
                title="Выйти"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Мобильная кнопка бургера */}
          <div className="md:hidden flex items-center space-x-2">
            <button onClick={openReleases} className="relative p-2 text-slate-500 hover:text-blue-600 rounded-lg transition" title="Что нового" aria-label="Что нового">
              <Bell className="w-4 h-4" />
              {unread.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-red-600 text-white text-[9px] font-bold flex items-center justify-center">{unread.length}</span>
              )}
            </button>
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
              const isActive = item.id === 'admin' ? isAdminSection : currentTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    if (item.id === 'game') { window.open('/game', '_blank'); return; }
                    setActiveTab(item.id === 'admin' ? (isAdminSection ? currentTab : 'users') : (item.id as TabType));
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
            <div className="p-3 bg-slate-50 rounded-xl mb-3 flex items-center justify-between">
              <div>
                <div className="font-bold text-xs text-slate-900">{profile?.full_name || user.email}</div>
                <div className="text-[10px] text-slate-500">{ROLE_LABELS[profile?.role ?? 'user']}</div>
              </div>
              <button
                onClick={() => signOut()}
                className="text-xs text-red-600 font-semibold"
              >
                Выйти
              </button>
            </div>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === 'admin' ? isAdminSection : currentTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    if (item.id === 'game') { window.open('/game', '_blank'); return; }
                    setActiveTab(item.id === 'admin' ? (isAdminSection ? currentTab : 'users') : (item.id as TabType));
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
        <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="w-7 h-7 text-blue-600 animate-spin" /></div>}>
        {/* Экран формы создания / редактирования вопроса */}
        {isQuestionFormOpen && isStaff ? (
          <QuestionForm
            initialData={editingQuestion}
            onSuccess={() => {
              setIsQuestionFormOpen(false);
              setEditingQuestion(null);
              setSaveToast('Изменения сохранены в базе');
            }}
            onCancel={() => {
              setIsQuestionFormOpen(false);
              setEditingQuestion(null);
            }}
          />
        ) : (
          <>
            {isAdminSection && (
              <div className="flex space-x-1 mb-5 border-b border-slate-200">
                {([['users', 'Пользователи и аудит', Users], ['stats', 'Статистика', BarChart3]] as const).map(([id, label, Icon]) => (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    className={`py-2 px-4 text-xs font-semibold border-b-2 -mb-px flex items-center space-x-2 transition-all ${
                      currentTab === id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            )}
            {currentTab === 'questions' && (
              <QuestionList
                onAddQuestion={handleAddQuestion}
                onEditQuestion={handleEditQuestion}
              />
            )}
            {currentTab === 'taxonomy' && <TaxonomyManager />}
            {currentTab === 'generator' && <TicketGenerator />}
            {currentTab === 'saved_tickets' && <SavedTicketsView />}
            {currentTab === 'bulk_import' && (
              <BulkImport onSuccess={() => setActiveTab('questions')} />
            )}
            {currentTab === 'users' && <UserManagementView />}
            {currentTab === 'stats' && <StatsView />}
            {currentTab === 'cluster' && isOwner && <ClusterExam />}
            {currentTab === 'releases' && <ReleasesView />}
          </>
        )}
        </Suspense>
      </main>

      {showNews && <WhatsNewModal releases={unread} onClose={closeNews} onOpenHistory={() => { closeNews(); openReleases(); }} />}

      {/* Подтверждение сохранения */}
      {saveToast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center space-x-2 bg-emerald-600 text-white px-4 py-3 rounded-xl shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span className="text-sm font-medium">{saveToast}</span>
        </div>
      )}

      {/* Футер */}
      <footer className="bg-white border-t border-slate-200 py-4 text-center text-xs text-slate-400">
        Система экзаменационных билетов • Десктопная и мобильная версии • Supabase RLS
      </footer>
    </div>
  );
};

export default App;
