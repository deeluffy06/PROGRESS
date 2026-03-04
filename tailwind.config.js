/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        parchment: {
          50: '#fcfaf5',
          100: '#f9f5ea',
          200: '#f1e6d3',
          300: '#e5d1b3',
          400: '#d7b88e',
          500: '#ca9f6b',
          600: '#bd8b52',
          700: '#9d7045',
          800: '#815c3c',
          900: '#684b33',
        },
        espresso: {
          50: '#f6f4f2',
          100: '#ebe6e0',
          200: '#dbcbc0',
          300: '#c5ae9b',
          400: '#af8c73',
          500: '#9e7352',
          600: '#916147',
          700: '#794d3a',
          800: '#644033',
          900: '#2c1c11', // Based on image sidebar
          950: '#1b1009',
        },
        gold: {
          400: '#c18b3d',
          500: '#a67c00', // Gold accents
        }
      },
      fontFamily: {
        serif: ['"Playfair Display"', '"Merriweather"', 'serif'],
        sans: ['"Inter"', '"Roboto"', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
