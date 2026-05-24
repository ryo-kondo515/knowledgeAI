import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Personal Knowledge AI",
  description: "A local-first RAG notebook for learning AI SaaS design.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
