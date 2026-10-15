/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __CANVAS_BUILD_STAMP__: string;

interface ImportMetaEnv {
    readonly VITE_CANVAS_BUILD_STAMP?: string;
}
declare const __BEEFTV_HEAVY_MEDIA_ENABLED__: boolean;
