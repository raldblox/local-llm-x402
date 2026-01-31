import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ChatProvider } from "@/components/ui/chat-context";
import "./globals.css";

const interSans = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "local-llm-x402",
  description:
    "Expose your local AI model as a paid, token-metered inference API using Aptos x402.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${interSans.variable} ${jetBrainsMono.variable} antialiased`}
      >
        <ChatProvider>{children}</ChatProvider>
      </body>
    </html>
  );
}
