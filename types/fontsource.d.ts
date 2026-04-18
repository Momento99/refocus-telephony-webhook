// Side-effect-импорты CSS — для TypeScript.
// Next.js обрабатывает их в рантайме, нам нужны только декларации типов.
declare module '*.css';
declare module '@fontsource/*';
declare module '@fontsource/*/*.css';
