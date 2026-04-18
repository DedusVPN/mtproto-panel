import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          base:     '#0d0c0a',              // очень тёмный, чуть тёплый
          surface:  '#141210',              // поверхность (сайдбар, шапка)
          elevated: '#1c1a14',              // приподнятый уровень (карточки)
          overlay:  '#242018',              // модалки, оверлеи
          border:   '#2e2a1a',              // границы — тёплый тёмно-янтарный
        },
        accent: {
          DEFAULT: '#f59e0b',               // amber-500 (близко к #fab005)
          hover:   '#fbbf24',               // amber-400, светлее
          muted:   'rgba(245,158,11,0.15)',
        },
        text: {
          primary:   '#ede8e0',             // слегка тёплый белый
          secondary: '#a09070',             // тёплый средний
          muted:     '#5e5040',             // приглушённый
          link:      '#fbbf24',             // золотой линк
        },
        success: {
          DEFAULT: '#34d399',
          muted:   'rgba(52,211,153,0.15)',
          bg:      'rgba(52,211,153,0.08)',
        },
        warning: {
          DEFAULT: '#fb923c',               // оранжевый — отличается от золотого акцента
          muted:   'rgba(251,146,60,0.15)',
          bg:      'rgba(251,146,60,0.08)',
        },
        danger: {
          DEFAULT: '#f43f5e',
          muted:   'rgba(244,63,94,0.15)',
          bg:      'rgba(244,63,94,0.08)',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        card: '0.875rem',
        btn:  '0.5rem',
      },
      backgroundImage: {
        'gradient-base':
          'radial-gradient(ellipse at 20% 0%, rgba(245,158,11,0.09) 0%, transparent 50%),' +
          'radial-gradient(ellipse at 80% 100%, rgba(250,176,5,0.06) 0%, transparent 50%)',
      },
      boxShadow: {
        card:       '0 1px 3px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03)',
        'card-hover': '0 4px 16px rgba(0,0,0,0.6), 0 0 0 1px rgba(245,158,11,0.35)',
        glow:       '0 0 20px rgba(245,158,11,0.3)',
      },
      animation: {
        'fade-in':   'fadeIn 0.2s ease-out',
        'slide-in':  'slideIn 0.2s ease-out',
        'pulse-dot': 'pulseDot 2s infinite',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        slideIn: {
          from: { opacity: '0', transform: 'translateX(-8px)' },
          to:   { opacity: '1', transform: 'translateX(0)' },
        },
        pulseDot: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.4' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config
