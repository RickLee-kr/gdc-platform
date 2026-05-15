/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        gdc: {
          /** L0 — canvas (#050B17–#081120) */
          page: '#06101c',
          /** L1 — sidebar / header chrome */
          panel: '#071420',
          /** L1 — nested bands, filter bars */
          section: '#081928',
          /** L2 — cards, tables (#0B1422–#101A2C) */
          card: '#0c1522',
          cardHover: '#101a2c',
          /** L3 — modals, menus */
          elevated: '#132033',
          /** Table header strip — slightly recessed vs body */
          tableHeader: '#081522',
          /** Row / nav hover */
          rowHover: '#0f1c2e',
          /** rgba(120,150,220,0.14) — default edge */
          border: 'rgba(120, 150, 220, 0.14)',
          /** rgba(120,150,220,0.20) — inputs, focus chrome */
          borderStrong: 'rgba(120, 150, 220, 0.2)',
          /** Hairlines */
          divider: 'rgba(120, 150, 220, 0.11)',
          /** Body secondary */
          muted: '#93A4C3',
          /** Labels, table headers */
          mutedStrong: '#a3b5d0',
          /** Primary copy */
          foreground: '#E6EDF7',
          /** Placeholders on controls */
          placeholder: '#6d8098',
          /** Same family as card; inset by border */
          input: '#0c1522',
          inputHover: '#0e1828',
          inputBorder: 'rgba(120, 150, 220, 0.22)',
          primary: '#7C3AED',
        },
      },
      boxShadow: {
        /** Low-lift dark surfaces — no “white card” glow */
        'gdc-card': 'inset 0 1px 0 rgba(120,150,220,0.045), 0 1px 1px rgba(0,0,0,0.42)',
        'gdc-elevated': 'inset 0 1px 0 rgba(120,150,220,0.05), 0 10px 28px rgba(0,0,0,0.48)',
        'gdc-control': 'inset 0 1px 0 rgba(120,150,220,0.04), 0 1px 1px rgba(0,0,0,0.38)',
      },
      backgroundImage: {
        'gdc-page-glow': 'radial-gradient(120% 90% at 50% -28%, rgba(124,58,237,0.04), transparent 55%)',
      },
    },
  },
  darkMode: 'class',
  plugins: [],
}
