import type { Config } from 'tailwindcss';

// Fase 1: base. La Fase 2 (T2.1) expande con los tokens del design-system
// (alias semánticos vía CSS vars).
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
