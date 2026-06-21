/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_V1_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
