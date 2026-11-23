/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Cool lavender-tinted neutrals (replaces default gray everywhere)
        gray: {
          50: '#f7f7fc',
          100: '#eeedf8',
          200: '#dcdaf0',
          300: '#bebbdc',
          400: '#9a96c0',
          500: '#76729c',
          600: '#57537a',
          700: '#3b3860',
          800: '#272447',
          900: '#16142e',
          950: '#0c0a1f',
        },
        // Brand accent: electric violet (replaces default blue)
        blue: {
          50: '#f3f0ff',
          100: '#e9e3ff',
          200: '#d5cbff',
          300: '#b9a6ff',
          400: '#9d7dff',
          500: '#8655fb',
          600: '#7438f0',
          700: '#6127d4',
          800: '#5122ab',
          900: '#431f88',
          950: '#28115c',
        },
        ink: {
          950: '#06051a',
          900: '#0b0a24',
          800: '#121033',
          700: '#1b1845',
        },
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(157,125,255,.25), 0 10px 40px -10px rgba(134,85,251,.55)',
        'glow-cyan': '0 10px 40px -10px rgba(34,211,238,.5)',
        card: '0 1px 0 0 rgba(255,255,255,.04) inset, 0 20px 50px -20px rgba(0,0,0,.6)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: 0, transform: 'translateY(10px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
        pop: {
          '0%': { opacity: 0, transform: 'scale(.96) translateY(8px)' },
          '100%': { opacity: 1, transform: 'scale(1) translateY(0)' },
        },
        float: {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '50%': { transform: 'translate(30px,-25px) scale(1.08)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-up': 'fade-up .45s cubic-bezier(.2,.7,.2,1) both',
        pop: 'pop .25s cubic-bezier(.2,.7,.2,1) both',
        float: 'float 14s ease-in-out infinite',
        'float-slow': 'float 22s ease-in-out infinite reverse',
        shimmer: 'shimmer 2.2s linear infinite',
      },
    },
  },
  plugins: [],
}
