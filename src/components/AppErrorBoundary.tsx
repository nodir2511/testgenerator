import React from 'react';
import { reportError } from '../lib/errorReporter';

/** Ловит сбой отрисовки: вместо белого экрана показывает сообщение и отправляет ошибку в журнал */
export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    reportError(error, 'render');
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md bg-white rounded-2xl shadow-sm border border-slate-200 p-6 text-center space-y-3">
          <h1 className="text-lg font-bold text-slate-900">Что-то пошло не так</h1>
          <p className="text-sm text-slate-600">Ошибка уже записана в журнал. Обновите страницу, и всё продолжится с того же места.</p>
          <button onClick={() => window.location.reload()} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium">
            Обновить страницу
          </button>
        </div>
      </div>
    );
  }
}
