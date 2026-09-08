/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ARCHIVE_BASE: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
