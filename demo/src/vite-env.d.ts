/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NOTES_CONTRACT?: string;
  readonly VITE_NEAR_RPC_URL?: string;
  readonly VITE_NEAR_EXPLORER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
