import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Venn', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        scala: {
          black:        '#000000',
          surface1:     '#08080f',
          surface2:     '#0e0e1a',
          surface3:     '#141424',
          blue:         '#185de8',
          'blue-light': '#3b7ef5',
          green:        '#6bdda1',
          'text-primary': '#f0f0f5',
          'text-muted':   '#5a5a72',
          'text-subtle':  '#3a3a52',
        },
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        pulse_blue: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.4' },
        },
      },
      animation: {
        'fade-in':   'fade-in 0.3s ease-out',
        'pulse-blue': 'pulse_blue 1.5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}

export default config
