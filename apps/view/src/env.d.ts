/// <reference types="vite/client" />
declare const __DEMO__: boolean;
/** 사무실 PC(C)가 직접 보여 주는 판 (http://C:8770/b/) */
declare const __OFFICE__: boolean;
interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
}
