/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        win: {
          bg: 'rgba(20, 20, 24, 0.75)',
          surface: 'rgba(35, 35, 42, 0.65)',
          hover: 'rgba(255, 255, 255, 0.08)',
          active: 'rgba(255, 255, 255, 0.12)',
          border: 'rgba(255, 255, 255, 0.08)',
          borderLight: 'rgba(255, 255, 255, 0.14)',
          accent: '#0078d4',
          accentHover: '#1084d8',
          textMuted: '#9aa0a6',
        }
      },
      fontFamily: {
        sans: ['"Segoe UI Variable"', '"Segoe UI"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        'win-card': '0 4px 12px rgba(0, 0, 0, 0.3), 0 0 1px rgba(255, 255, 255, 0.1) inset',
        'win-glow': '0 0 20px rgba(0, 120, 212, 0.25)',
      }
    },
  },
  plugins: [],
}
