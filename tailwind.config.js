/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          hover: "hsl(var(--primary-hover))",
          soft: "hsl(var(--primary-soft))",
          ink: "hsl(var(--primary-ink))",
          foreground: "hsl(var(--primary-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          solid: "hsl(var(--success-solid))",
          soft: "hsl(var(--success-soft))",
          line: "hsl(var(--success-line))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          solid: "hsl(var(--warning-solid))",
          soft: "hsl(var(--warning-soft))",
          line: "hsl(var(--warning-line))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          soft: "hsl(var(--info-soft))",
          line: "hsl(var(--info-line))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          hover: "hsl(var(--destructive-hover))",
          soft: "hsl(var(--destructive-soft))",
          line: "hsl(var(--destructive-line))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        card: "var(--radius-card)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [],
}
