import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
      fontFamily: {
        heebo: ["var(--font-heebo)", "system-ui", "sans-serif"],
        rubik: ["var(--font-rubik)", "system-ui", "sans-serif"],
        assistant: ["var(--font-assistant)", "system-ui", "sans-serif"],
      },
      keyframes: {
        // Attention-grabbing alert flash for the "WhatsApp disconnected" banner.
        "alert-blink": {
          "0%, 100%": { backgroundColor: "rgb(220 38 38)" }, // red-600
          "50%": { backgroundColor: "rgb(153 27 27)" },      // red-800
        },
      },
      animation: {
        "alert-blink": "alert-blink 1.1s steps(1, end) infinite",
      },
    },
  },
  plugins: [],
};
export default config;
