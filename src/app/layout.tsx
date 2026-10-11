import type { Metadata, Viewport } from "next";
import { Nunito_Sans } from "next/font/google";
import "./globals.css";

const nunito = Nunito_Sans({
  subsets: ["latin"],
  variable: "--font-nunito",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "AspirEdge AI", template: "%s · AspirEdge AI" },
  description: "Career alignment for students and mentors: verified evidence, a clear gap, and one next step.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6efe7" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1714" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={nunito.variable}>
      <body className="min-h-dvh bg-sand text-ink">{children}</body>
    </html>
  );
}
