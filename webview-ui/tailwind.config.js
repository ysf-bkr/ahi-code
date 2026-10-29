/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    // Typography tokens are defined once in src/index.css (--ahi-text-*).
    // Tailwind only maps its utility names onto those variables so the CSS
    // design system stays the single source of truth.
    fontFamily: {
      sans: 'var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif)',
      mono: 'var(--vscode-editor-font-family, "SF Mono", Monaco, Menlo, Consolas, monospace)'
    },
    fontSize: {
      '2xs': ['var(--ahi-text-2xs)', { lineHeight: '1.2' }],
      xs: ['var(--ahi-text-xs)', { lineHeight: '1.35' }],
      sm: ['var(--ahi-text-sm)', { lineHeight: '1.4' }],
      base: ['var(--ahi-text-md)', { lineHeight: '1.45' }]
    }
  },
  plugins: []
};
