/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Fontsource packages ship CSS only. TypeScript 7 (tsrs) reports side-effect
// imports with no declaration (TS2882), so declare them here.
declare module '@fontsource-variable/*';
