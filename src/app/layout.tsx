import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DOMINANT Barbershop",
  description: "זימון תורים - DOMINANT Barbershop",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl">
      <body className="antialiased bg-neutral-950 text-white min-h-screen">
        {children}
      </body>
    </html>
  );
}
