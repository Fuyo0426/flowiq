import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FlowIQ \u2014 \u53F0\u80A1\u6CD5\u4EBA\u7C4C\u78BC\u5206\u6790",
  description: "\u8FFD\u8E64\u5916\u8CC7\u3001\u6295\u4FE1\u3001\u81EA\u71DF\u5546\u52D5\u5411\uFF0C\u638C\u63E1\u6CD5\u4EBA\u7C4C\u78BC\u5148\u884C\u8A0A\u865F",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
