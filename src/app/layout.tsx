import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "In The Loop · Meeting intelligence",
  description: "Ask your meetings. Find the evidence.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
