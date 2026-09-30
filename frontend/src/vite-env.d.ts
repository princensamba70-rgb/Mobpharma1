/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  /** Marker used only by the constrained, non-Gradle Android fallback wrapper. */
  __AMI_ANDROID__?: boolean;
  /** Keystore-backed bridge exposed by the fallback wrapper when present. */
  AmiPharmaSecureStorage?: {
    get: (key: string) => string | null;
    set: (key: string, value: string) => boolean;
    remove: (key: string) => boolean;
  };
}
