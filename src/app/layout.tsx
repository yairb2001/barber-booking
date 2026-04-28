import type { Metadata } from "next";
import {
  Frank_Ruhl_Libre,
  Bellefair,
  Suez_One,
  Rubik,
  Heebo,
  Assistant,
} from "next/font/google";
import "./globals.css";

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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // All font CSS variables are exposed on <body>; themes.ts picks one via --font-display / --font-body
  const fontVars = `${frank.variable} ${bellefair.variable} ${suez.variable} ${rubik.variable} ${heebo.variable} ${assistant.variable}`;
  return (
    <html lang="he" dir="rtl">
      <body className={`antialiased min-h-screen ${fontVars}`}>
        {children}
      </body>
    </html>
  );
}
