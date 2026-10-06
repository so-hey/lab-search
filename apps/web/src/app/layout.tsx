import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "研究室資料検索",
  description: "研究室共有Driveの論文・発表資料・研究文書を横断検索するWebアプリ",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
