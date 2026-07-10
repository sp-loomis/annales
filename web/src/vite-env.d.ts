/// <reference types="vite/client" />

declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}

// Side-effect font CSS imports.
declare module '@fontsource/*';
declare module '@fontsource-variable/*';
