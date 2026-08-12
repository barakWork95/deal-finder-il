import type { Metadata } from "next";
import { Assistant, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AppHeader } from "@/components/AppHeader";
import { MobileNav } from "@/components/MobileNav";

// Hebrew UI: Assistant — modern, elegant, highly legible in both themes.
const assistant = Assistant({
  variable: "--font-sans-he",
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

// Numbers / prices / scores: JetBrains Mono — terminal/coding vibe, tabular.
const jetbrains = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "מאתר קרקעות ומגרשים | Deal Finder IL",
  description:
    "כל עסקאות הקרקע והמגרשים בישראל במקום אחד — מכרזי רמ\"י, כינוסי נכסים, קרקעות להשבחה ומכירות פרטיות, מדורגות עם ציון עסקה והתראות בזמן אמת.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="he"
      dir="rtl"
      data-theme="dark"
      className={`${assistant.variable} ${jetbrains.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <AppHeader />
        <main className="flex-1 pb-20 md:pb-0">{children}</main>
        <MobileNav />
      </body>
    </html>
  );
}
