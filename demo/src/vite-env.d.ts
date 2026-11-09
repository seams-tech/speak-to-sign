/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NOTES_CONTRACT?: string;
  readonly VITE_NEAR_RPC_URL?: string;
  readonly VITE_NEAR_EXPLORER_URL?: string;
  readonly VITE_SEAMS_PUBLISHABLE_KEY?: string;
  readonly VITE_SEAMS_PROJECT_ENVIRONMENT_ID?: string;
  readonly VITE_SEAMS_WALLET_ORIGIN?: string;
  readonly VITE_SEAMS_RELAYER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
