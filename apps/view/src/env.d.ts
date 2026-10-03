/// <reference types="vite/client" />
declare const __DEMO__: boolean;
/** 이 화면을 만든 시각 (ISO) — 설정에 앱 버전으로 */
declare const __BUILD__: string;
interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
}
