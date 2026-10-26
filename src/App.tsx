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
  MoreHorizontal,
  ChevronRight
} from 'lucide-react';

type TabType = 'questions' | 'taxonomy' | 'generator' | 'saved_tickets' | 'bulk_import' | 'users' | 'stats' | 'cluster' | 'releases';

// Раздел виден в адресе (#archive и т. п.): работает кнопка «Назад» на телефоне, на раздел можно дать ссылку
const TAB_HASH: Record<TabType, string> = {
  generator: 'generator', saved_tickets: 'archive', questions: 'questions', taxonomy: 'taxonomy',
  bulk_import: 'import', users: 'users', stats: 'stats', cluster: 'cluster', releases: 'news',
};
const tabFromHash = (hash: string): TabType | null => {
  const key = hash.replace(/^#/, '').split('/')[0];
  return (Object.keys(TAB_HASH) as TabType[]).find((t) => TAB_HASH[t] === key) ?? null;
};
const isFormHash = (hash: string) => hash.startsWith('#questions/');
const LEAVE_FORM_TEXT = 'Есть несохранённые изменения в вопросе. Закрыть без сохранения?';

export const App: React.FC = () => {
  const { user, profile, isAdmin, isOwner, isStaff, signOut, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    const fromHash = tabFromHash(window.location.hash);
    if (fromHash) return fromHash;
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

  // История браузера: разделы, форма вопроса и меню «Ещё» — отдельные шаги, «Назад» возвращает на предыдущий.
  // Ref-ы читаются в обработчике popstate, где состояние React может быть устаревшим.
  const formOpenRef = React.useRef(false);
  const formDirtyRef = React.useRef(false);
  const sheetOpenRef = React.useRef(false);
  const hashOf = (tab: TabType) => `#${TAB_HASH[tab]}`;

  React.useEffect(() => {
    // Открыли сайт со ссылкой на форму (после перезагрузки) — формы уже нет, показываем раздел
    window.history.replaceState(null, '', hashOf(tabFromHash(window.location.hash) ?? activeTab));
    const onPop = () => {
      if (sheetOpenRef.current) {
        sheetOpenRef.current = false;
        setMobileMenuOpen(false);
        return;
      }
      const hash = window.location.hash;
      if (formOpenRef.current && !isFormHash(hash)) {
        if (formDirtyRef.current && !window.confirm(LEAVE_FORM_TEXT)) {
          window.history.pushState(null, '', '#questions/edit');
          return;
        }
        formOpenRef.current = false;
        formDirtyRef.current = false;
        setIsQuestionFormOpen(false);
        setEditingQuestion(null);
      }
      const tab = tabFromHash(hash);
      if (tab) setActiveTab(tab);
    };
    window.addEventListener('popstate', onPop);
    // Закрытие вкладки с несохранённым вопросом — браузер спросит сам
    const onUnload = (e: BeforeUnloadEvent) => {
      if (formOpenRef.current && formDirtyRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, []);

  const closeFormState = () => {
    formOpenRef.current = false;
    formDirtyRef.current = false;
    setIsQuestionFormOpen(false);
    setEditingQuestion(null);
  };

  // Переход в раздел. Из формы или меню «Ещё» — заменяем их шаг истории, чтобы «Назад» не открывал их снова
  const goTab = (tab: TabType) => {
    if (formOpenRef.current && formDirtyRef.current && !window.confirm(LEAVE_FORM_TEXT)) return false;
    const replace = formOpenRef.current || sheetOpenRef.current;
    sheetOpenRef.current = false;
    setMobileMenuOpen(false);
    if (formOpenRef.current) closeFormState();
    if (replace) window.history.replaceState(null, '', hashOf(tab));
    else if (window.location.hash !== hashOf(tab)) window.history.pushState(null, '', hashOf(tab));
    if (tab !== activeTab) window.scrollTo({ top: 0 });
    setActiveTab(tab);
    return true;
  };

  const openSheet = () => {
    sheetOpenRef.current = true;
    window.history.pushState(null, '', window.location.hash);
    setMobileMenuOpen(true);
  };
  const closeSheet = () => {
    if (sheetOpenRef.current) window.history.back();
  };

  // Обновления сайта: окно «Что нового» при входе, пока есть непрочитанные версии
  const { unread, markRead } = useReleases();
  const [newsDismissed, setNewsDismissed] = useState(false);
  const showNews = !!user && !newsDismissed && unread.length > 0 && currentTab !== 'releases';
  const closeNews = () => {
    setNewsDismissed(true);
    markRead(unread.map((r) => r.id));
  };
  const openReleases = () => {
    goTab('releases');
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

  const openForm = (q: Question | null) => {
    setEditingQuestion(q);
    setIsQuestionFormOpen(true);
    formOpenRef.current = true;
    formDirtyRef.current = false;
    window.history.pushState(null, '', q ? '#questions/edit' : '#questions/new');
    window.scrollTo({ top: 0 });
  };
  const handleAddQuestion = () => openForm(null);
  const handleEditQuestion = (q: Question) => openForm(q);

  // Закрыть форму: шаг формы в истории убираем «Назад»-ом (popstate закроет форму)
  const closeForm = (force = false) => {
    if (!force && formDirtyRef.current && !window.confirm(LEAVE_FORM_TEXT)) return;
    formDirtyRef.current = false;
    if (isFormHash(window.location.hash)) window.history.back();
    else closeFormState();
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
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans text-slate-900 antialiased selection:bg-indigo-500/20 selection:text-indigo-900">
      {/* Главный заголовок */}
      <header className="bg-white/85 backdrop-blur-md border-b border-slate-200/80 sticky top-0 z-40 shadow-xs pt-[env(safe-area-inset-top)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Логотип */}
          <div className="flex items-center space-x-3 cursor-pointer group" onClick={() => goTab('generator')}>
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-600 via-blue-600 to-indigo-500 text-white flex items-center justify-center shadow-md shadow-indigo-500/20 group-hover:scale-105 transition-transform">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-1.5">
                <h1 className="font-bold text-base sm:text-lg text-slate-900 leading-tight tracking-tight">
                  Экзаменатор
                </h1>
              </div>
              <p className="hidden sm:block text-xs text-slate-500 font-medium">Банк вопросов и генератор билетов</p>
            </div>
          </div>

          {/* Десктоп-меню пользователя */}
          <div className="hidden md:flex items-center space-x-3">
            <div className="flex items-center space-x-3 bg-white px-3 py-1.5 rounded-2xl border border-slate-200/80 shadow-xs">
              <div className="w-7 h-7 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center font-bold text-xs">
                <UserIcon className="w-4 h-4" />
              </div>
              <div className="text-left">
                <div className="text-xs font-bold text-slate-800 leading-tight">
                  {profile?.full_name || user.email?.split('@')[0]}
                </div>
                <div className="text-xs text-slate-500 flex items-center font-semibold">
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
              <button 
                onClick={openReleases} 
                className="relative p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition" 
                title="Что нового" 
                aria-label="Что нового"
              >
                <Bell className="w-4 h-4" />
                {unread.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-red-600 text-white text-[9px] font-bold flex items-center justify-center animate-pulse">
                    {unread.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => signOut()}
                className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition"
                title="Выйти"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Мобильные быстрые кнопки в шапке */}
          <div className="md:hidden flex items-center space-x-1.5">
            <TelegramLink />
            <button 
              onClick={openReleases} 
              className="relative p-2 text-slate-500 hover:text-indigo-600 active:scale-90 rounded-xl transition hover:bg-slate-100" 
              title="Что нового" 
              aria-label="Что нового"
            >
              <Bell className="w-4 h-4" />
              {unread.length > 0 && (
                <span className="absolute 1 top-1 right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-red-600 text-white text-[9px] font-bold flex items-center justify-center">
                  {unread.length}
                </span>
              )}
            </button>
            <button
              onClick={openSheet}
              className="flex items-center space-x-1.5 p-1.5 pl-2.5 bg-slate-100/90 active:scale-95 border border-slate-200/80 rounded-2xl text-slate-700"
              aria-label="Открыть меню профиля"
            >
              <div className="w-6 h-6 rounded-lg bg-indigo-600 text-white flex items-center justify-center text-xs font-bold">
                {(profile?.full_name || user.email || 'U')[0].toUpperCase()}
              </div>
              <Menu className="w-4 h-4 text-slate-500" />
            </button>
          </div>
        </div>

        {/* Навигационная панель табов (десктоп) в Bento-стиле */}
        <div className="hidden md:block bg-white/70 border-t border-slate-200/60 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto flex space-x-1 py-1.5 overflow-x-auto no-scrollbar">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === 'admin' ? isAdminSection : currentTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    if (item.id === 'game') { window.open('/game', '_blank'); return; }
                    goTab(item.id === 'admin' ? (isAdminSection ? currentTab : 'users') : (item.id as TabType));
                  }}
                  className={`py-2 px-3.5 rounded-xl text-xs font-semibold flex items-center space-x-2 whitespace-nowrap transition-all duration-150 active:scale-98 ${
                    isActive
                      ? 'bg-indigo-50 text-indigo-700 border border-indigo-200/80 shadow-xs font-bold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80 border border-transparent'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-indigo-600' : 'text-slate-500'}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* Мобильное всплывающее меню (Bottom Sheet Drawer) */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end">
          {/* Затемнение фона с закрытием при тапе */}
          <div 
            className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs transition-opacity duration-200 animate-in fade-in"
            onClick={closeSheet}
          />

          {/* Панель-шторка снизу */}
          <div className="relative bg-white rounded-t-3xl border-t border-slate-200/80 shadow-2xl p-5 max-h-[85vh] overflow-y-auto pb-[calc(2rem+env(safe-area-inset-bottom))] z-10 animate-in slide-in-from-bottom duration-200">
            {/* Индикатор смахивания */}
            <div className="w-12 h-1 bg-slate-200 rounded-full mx-auto mb-4" />

            {/* Профиль пользователя */}
            <div className="p-4 bg-slate-50/90 rounded-2xl border border-slate-200/70 mb-4 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-bold text-base shadow-sm shadow-indigo-500/20">
                  {(profile?.full_name || user.email || 'U')[0].toUpperCase()}
                </div>
                <div>
                  <div className="font-bold text-sm text-slate-900 leading-tight">
                    {profile?.full_name || user.email}
                  </div>
                  <div className="text-xs text-indigo-600 font-semibold mt-0.5">
                    {isStaff ? (isOwner ? 'Главный администратор' : ROLE_LABELS[profile?.role ?? 'admin']) : ROLE_LABELS[profile?.role ?? 'user']}
                  </div>
                </div>
              </div>
              <button
                onClick={closeSheet}
                aria-label="Закрыть меню"
                className="w-10 h-10 rounded-xl bg-slate-200/70 text-slate-500 flex items-center justify-center active:scale-90"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Все разделы меню */}
            <div className="space-y-1">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider px-2 py-1">
                Разделы
              </div>
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = item.id === 'admin' ? isAdminSection : currentTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      if (item.id === 'game') { window.open('/game', '_blank'); closeSheet(); return; }
                      goTab(item.id === 'admin' ? (isAdminSection ? currentTab : 'users') : (item.id as TabType));
                    }}
                    className={`w-full text-left py-3 px-3.5 rounded-2xl text-xs font-semibold flex items-center justify-between transition active:scale-98 ${
                      isActive 
                        ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/25' 
                        : 'text-slate-700 hover:bg-slate-100 active:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                      <span>{item.label}</span>
                    </div>
                    <ChevronRight className={`w-4 h-4 ${isActive ? 'text-indigo-200' : 'text-slate-500'}`} />
                  </button>
                );
              })}
            </div>

            {/* Быстрые действия */}
            <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
              <button
                onClick={openReleases}
                className="w-full py-2.5 px-3.5 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100/70 flex items-center justify-between"
              >
                <div className="flex items-center space-x-2">
                  <Bell className="w-4 h-4 text-indigo-600" />
                  <span>Что нового</span>
                </div>
                {unread.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-red-600 text-white text-xs font-bold">
                    +{unread.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => {
                  closeSheet();
                  signOut();
                }}
                className="w-full py-2.5 px-3.5 rounded-xl text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100/80 flex items-center justify-center space-x-2 transition active:scale-98"
              >
                <LogOut className="w-4 h-4" />
                <span>Выйти из аккаунта</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Основной контент */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 pb-24 md:pb-8">
        <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="w-7 h-7 text-blue-600 animate-spin" /></div>}>
        {/* Экран формы создания / редактирования вопроса */}
        {isQuestionFormOpen && isStaff ? (
          <QuestionForm
            initialData={editingQuestion}
            onSuccess={() => closeForm(true)}
            onCancel={() => closeForm()}
            onDirtyChange={(d) => { formDirtyRef.current = d; }}
          />
        ) : (
          <>
            {isAdminSection && (
              <div className="flex space-x-1 mb-5 border-b border-slate-200">
                {([['users', 'Пользователи', Users], ['stats', 'Статистика', BarChart3]] as const).map(([id, label, Icon]) => (
                  <button
                    key={id}
                    onClick={() => goTab(id)}
                    className={`flex-1 sm:flex-none justify-center min-h-[44px] px-4 text-sm font-semibold border-b-2 -mb-px flex items-center space-x-2 transition-all ${
                      currentTab === id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'
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
              <BulkImport onSuccess={() => goTab('questions')} />
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

      {/* Футер (десктоп) */}
      <footer className="hidden md:block bg-white/70 border-t border-slate-200/80 py-4 text-center text-xs text-slate-500">
        Экзаменатор — банк вопросов и генератор билетов
      </footer>

      {/* Мобильная нижняя навигация (Floating Bottom Bar под большой палец) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-xl border-t border-slate-200/80 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_20px_rgba(15,23,42,0.06)]">
        <div className="grid grid-cols-4 h-16 items-center px-2">
          {/* Генератор */}
          <button
            onClick={() => goTab('generator')}
            className={`flex flex-col items-center justify-center py-1 transition-transform active:scale-90 ${
              currentTab === 'generator' && !isQuestionFormOpen
                ? 'text-indigo-600 font-bold'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <div className={`p-1.5 rounded-xl transition-colors ${
              currentTab === 'generator' && !isQuestionFormOpen ? 'bg-indigo-50 text-indigo-600 shadow-xs' : ''
            }`}>
              <Sparkles className="w-5 h-5" />
            </div>
            <span className="text-xs mt-0.5 tracking-tight">Билеты</span>
          </button>

          {/* Банк вопросов */}
          <button
            onClick={() => goTab('questions')}
            className={`flex flex-col items-center justify-center py-1 transition-transform active:scale-90 ${
              currentTab === 'questions' && !isQuestionFormOpen
                ? 'text-indigo-600 font-bold'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <div className={`p-1.5 rounded-xl transition-colors ${
              currentTab === 'questions' && !isQuestionFormOpen ? 'bg-indigo-50 text-indigo-600 shadow-xs' : ''
            }`}>
              <FileQuestion className="w-5 h-5" />
            </div>
            <span className="text-xs mt-0.5 tracking-tight">Вопросы</span>
          </button>

          {/* Сохраненные билеты */}
          <button
            onClick={() => goTab('saved_tickets')}
            className={`flex flex-col items-center justify-center py-1 transition-transform active:scale-90 ${
              currentTab === 'saved_tickets' && !isQuestionFormOpen
                ? 'text-indigo-600 font-bold'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <div className={`p-1.5 rounded-xl transition-colors ${
              currentTab === 'saved_tickets' && !isQuestionFormOpen ? 'bg-indigo-50 text-indigo-600 shadow-xs' : ''
            }`}>
              <FileCheck2 className="w-5 h-5" />
            </div>
            <span className="text-xs mt-0.5 tracking-tight">Архив</span>
          </button>

          {/* Меню "Ещё" */}
          <button
            onClick={openSheet}
            className={`flex flex-col items-center justify-center py-1 transition-transform active:scale-90 ${
              mobileMenuOpen || (!['generator', 'questions', 'saved_tickets'].includes(currentTab) && !isQuestionFormOpen)
                ? 'text-indigo-600 font-bold'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <div className={`p-1.5 rounded-xl transition-colors ${
              !['generator', 'questions', 'saved_tickets'].includes(currentTab) && !isQuestionFormOpen ? 'bg-indigo-50 text-indigo-600 shadow-xs' : ''
            }`}>
              <MoreHorizontal className="w-5 h-5" />
            </div>
            <span className="text-xs mt-0.5 tracking-tight">Ещё</span>
          </button>
        </div>
      </nav>
    </div>
  );
};

export default App;
