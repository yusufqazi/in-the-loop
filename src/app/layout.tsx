import type { Metadata } from "next";
import { Barlow_Condensed, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-display",
  display: "swap",
});
const body = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "In The Loop · Meeting intelligence",
  description: "Ask your meetings. Find the evidence.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
