/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    // Tipografi jetonları src/index.css içinde (--ahi-text-*) tanımlanır.
    // Tailwind bu değişkenleri adlara eşler, böylece CSS tek doğruluk kaynağı kalır.
    fontFamily: {
      sans: 'var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif)',
      mono: 'var(--vscode-user-editor-font-family, var(--vscode-editor-font-family, "SF Mono", Monaco, Menlo, Consolas, monospace))'
    },
    fontSize: {
      '2xs': ['var(--ahi-text-2xs)', { lineHeight: '1.25' }],
      xs: ['var(--ahi-text-xs)', { lineHeight: '1.35' }],
      sm: ['var(--ahi-text-sm)', { lineHeight: '1.45' }],
      base: ['var(--ahi-text-md)', { lineHeight: '1.5' }],
      md: ['var(--ahi-text-md)', { lineHeight: '1.5' }],
      lg: ['var(--ahi-text-lg)', { lineHeight: '1.55' }],
      xl: ['1.25rem', { lineHeight: '1.6' }]
    }
  },
  plugins: []
};
