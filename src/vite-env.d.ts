/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_TELEGRAM_BOT_USERNAME?: string;
  readonly VITE_SUPPORT_TELEGRAM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Идентификатор сборки (подставляется в vite.config.ts); у dev-сервера — 'dev'
declare const __BUILD_ID__: string;
