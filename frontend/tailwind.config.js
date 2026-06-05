/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: "#1a3a6b",
          light: "#1e4a8a",
        },
        accent: "#4a7fd4",
      },
    },
  },
  plugins: [],
};
