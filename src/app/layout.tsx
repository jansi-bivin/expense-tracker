import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ExpTrack",
  description: "Family expense tracking from bank SMS",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
