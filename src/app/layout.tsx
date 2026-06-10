import type { Metadata, Viewport } from "next";
import {
  Frank_Ruhl_Libre,
  Bellefair,
  Suez_One,
  Rubik,
  Heebo,
  Assistant,
} from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { getServerTheme } from "@/lib/server-theme";

// ─── Theme fonts (each theme picks one for display + one for body) ──
const frank = Frank_Ruhl_Libre({
  subsets: ["latin", "hebrew"],
  weight: ["300", "400", "500", "700", "900"],
  variable: "--font-frank",
  display: "swap",
});

const bellefair = Bellefair({
  subsets: ["latin", "hebrew"],
  weight: ["400"],
  variable: "--font-bellefair",
  display: "swap",
});

const suez = Suez_One({
  subsets: ["latin", "hebrew"],
  weight: ["400"],
  variable: "--font-suez",
  display: "swap",
});

const rubik = Rubik({
  subsets: ["latin", "hebrew"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-rubik",
  display: "swap",
});

const heebo = Heebo({
  subsets: ["latin", "hebrew"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-heebo",
  display: "swap",
});

const assistant = Assistant({
  subsets: ["latin", "hebrew"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-assistant",
  display: "swap",
});

export const metadata: Metadata = {
  title: "DOMINANT Barbershop",
  description: "זימון תורים - DOMINANT Barbershop",
};

// iOS/Android native-app behaviour:
// - maximumScale 1 + userScalable false  → no pinch-zoom, and no auto-zoom when
//   focusing an input (combined with the 16px input font-size in globals.css).
// - viewportFit "cover"                   → content extends under the notch /
//   home-indicator so safe-area insets work.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0d9488",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // All font CSS variables are exposed on <body>; themes.ts picks one via --font-display / --font-body
  const fontVars = `${frank.variable} ${bellefair.variable} ${suez.variable} ${rubik.variable} ${heebo.variable} ${assistant.variable}`;
  // Resolve the theme on the server so the first paint is already correct
  // (prevents the flash of the default gold theme before the client fetch).
  const theme = await getServerTheme();
  return (
    <html lang="he" dir="rtl">
      <body className={`antialiased min-h-screen ${fontVars}`}>
        <ThemeProvider theme={theme}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
