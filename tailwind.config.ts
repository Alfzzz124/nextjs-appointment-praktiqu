import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Primary purple (#3625cd)
        primary: {
          DEFAULT: '#3625cd',
          50: '#f0ecf9',
          100: '#e2dfff',
          200: '#c3c0ff',
          300: '#a49efb',
          400: '#8a7df7',
          500: '#6f5df0',
          600: '#5046e5',
          700: '#3625cd',
          800: '#2a1da6',
          900: '#1e1580',
          950: '#160d5a',
        },
        // Surface / background
        surface: '#fcf8ff',
        'surface-dim': '#dcd8e5',
        // Container colors
        'surface-container-low': '#f6f2ff',
        'surface-container': '#f0ecf9',
        'surface-container-high': '#eae6f4',
        'surface-container-highest': '#e4e1ee',
        // Text colors
        'on-surface': '#1b1b24',
        'on-surface-variant': '#464555',
        // Outline
        outline: '#777587',
        'outline-variant': '#c7c4d8',
        // Secondary
        secondary: {
          DEFAULT: '#4953bc',
          50: '#e8eaff',
          100: '#c5c7f5',
          600: '#3d45a0',
          700: '#303684',
          800: '#242868',
        },
        tertiary: '#7e3000',
        'tertiary-container': '#a54100',
        // Semantic
        amber: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
        },
        red: {
          50: '#fef2f2',
          100: '#fee2e2',
          200: '#fecaca',
          300: '#fca5a5',
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
          800: '#991b1b',
          900: '#7f1d1d',
          950: '#450a0a',
        },
        green: {
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#14532d',
          900: '#166534',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-in': 'slideIn 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}

export default config
