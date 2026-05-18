/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  darkMode: 'class', // Fix for NativeWind dark mode
  theme: {
    extend: {
      colors: {
        'industrial-dark': '#0F172A',
        'industrial-orange': '#F59E0B',
        'industrial-grey': '#1E293B',
      },
    },
  },
  plugins: [],
}

