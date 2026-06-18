/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_V1_BASE?: string
  readonly VITE_OPENCODE_API_BASE?: string
  readonly VITE_MAINTENANCE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
