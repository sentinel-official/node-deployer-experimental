/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Approximated from the provided dark-theme mockups
        bg: {
          DEFAULT: '#0B1020',
          soft: '#0F162B',
          card: '#131B33',
          elev: '#182243',
          sidebar: '#0A0F20',
          input: '#0D1428',
        },
        border: {
          DEFAULT: '#1E2A4E',
          soft: '#26325A',
        },
        text: {
          DEFAULT: '#E6ECFF',
          muted: '#8A97C3',
          dim: '#5E6B94',
        },
        accent: {
          DEFAULT: '#4F7CFF',
          strong: '#3A64E8',
          soft: '#2A3E7A',
        },
        success: '#2ED37E',
        warning: '#F2B33C',
        danger: '#F25C6A',
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'Menlo', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 0 rgba(255,255,255,0.03) inset, 0 8px 24px rgba(0,0,0,0.35)',
      },
    },
  },
  plugins: [],
};
