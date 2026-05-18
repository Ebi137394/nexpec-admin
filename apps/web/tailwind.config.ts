import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ─── NEXPEC brand palette ─────────────────────────────────────
        // Mirrors the mobile app so a designer never has to context-switch.
        ink: {
          950: '#020420',   // deepest canvas — matches mobile splash
          900: '#070A2E',
          800: '#0A0D2C',   // card background
          700: '#11153B',
          600: '#1A1D3C',   // card border
        },
        violet: {
          glow: '#A78BFA',
          DEFAULT: '#7C3AED', // primary CTA
          deep: '#5B21B6',
        },
        cyan: {
          glow: '#00CFD5',    // trust accent
          DEFAULT: '#06B6D4',
        },
        accent: {
          green: '#10B981',
          amber: '#F59E0B',
          red: '#EF4444',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        display: ['var(--font-sans)', 'ui-sans-serif', 'system-ui'],
      },
      backgroundImage: {
        'radial-violet':
          'radial-gradient(ellipse at top, rgba(124, 58, 237, 0.25) 0%, rgba(2, 4, 32, 0) 60%)',
        'grid-faint':
          'linear-gradient(rgba(124, 58, 237, 0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(124, 58, 237, 0.04) 1px, transparent 1px)',
      },
      backgroundSize: {
        grid: '48px 48px',
      },
      animation: {
        'shimmer': 'shimmer 8s linear infinite',
        'pulse-slow': 'pulse 6s ease-in-out infinite',
        'fade-up': 'fade-up 0.6s ease-out forwards',
      },
      keyframes: {
        shimmer: {
          '0%, 100%': { 'background-position': '0% 0%' },
          '50%': { 'background-position': '100% 100%' },
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      boxShadow: {
        glow: '0 0 40px -8px rgba(124, 58, 237, 0.45)',
        'glow-cyan': '0 0 40px -8px rgba(0, 207, 213, 0.4)',
      },
      letterSpacing: {
        'industrial': '0.18em',
      },
    },
  },
  plugins: [],
};

export default config;
