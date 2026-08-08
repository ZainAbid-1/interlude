/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        'bg-app': '#0a0a0a',
        'surface': '#131313',
        'surface-container': '#1f1f1f',
        'surface-container-low': '#1b1b1b',
        'surface-container-high': '#2a2a2a',
        'surface-container-highest': '#353535',
        'surface-bright': '#393939',
        'on-bg': '#e2e2e2',
        'on-surface': '#e2e2e2',
        'on-surface-variant': '#c4c7c8',
        'text-muted': 'rgba(255, 255, 255, 0.4)',
        'text-subtle': 'rgba(255, 255, 255, 0.6)',
        'glass-bg': 'rgba(30, 30, 30, 0.4)',
        'glass-border': 'rgba(255, 255, 255, 0.1)',
        'glass-border-subtle': 'rgba(255, 255, 255, 0.05)',
        'outline-variant': '#444748',
        correct: '#4ade80',
        'correct-bg': 'rgba(74, 222, 128, 0.15)',
        incorrect: '#f87171',
        'incorrect-bg': 'rgba(248, 113, 113, 0.15)',
      },
      fontFamily: {
        display: ['Inter'],
        body: ['Inter'],
        serif: ['PlayfairDisplay'],
      },
      borderRadius: {
        glass: '16px',
        card: '24px',
      },
    },
  },
  plugins: [],
};
