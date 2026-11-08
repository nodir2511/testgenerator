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

/** Версия сайта из package.json (подставляет vite.config.ts) */
declare const __APP_VERSION__: string;
