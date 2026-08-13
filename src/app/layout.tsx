import type { Metadata } from "next";
import { Assistant, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AppHeader } from "@/components/AppHeader";
import { MobileNav } from "@/components/MobileNav";
import { AuthProvider } from "@/components/AuthProvider";

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

const DESCRIPTION =
  'כל עסקאות הקרקע והמגרשים בישראל במקום אחד — מכרזי רמ"י, כינוסי נכסים, קרקעות להשבחה ומכירות פרטיות, מדורגות עם ציון עסקה והתראות בזמן אמת.';

export const metadata: Metadata = {
  // Absolute base for the OG image; the deployment's public alias.
  metadataBase: new URL("https://deal-finder-il.vercel.app"),
  title: {
    default: "קרקעHOT — מכרזי קרקע ומגרשים בישראל",
    template: "%s | קרקעHOT",
  },
  description: DESCRIPTION,
  applicationName: "קרקעHOT",
  openGraph: {
    title: "קרקעHOT — מכרזי קרקע ומגרשים בישראל",
    description: DESCRIPTION,
    locale: "he_IL",
    type: "website",
    images: [{ url: "/brand/karkahot-logo.png", width: 420, height: 114, alt: "קרקעHOT" }],
  },
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
        {/* Pass-through until Clerk is switched on — see AuthProvider. */}
        <AuthProvider>
          <AppHeader />
          <main className="flex-1 pb-20 md:pb-0">{children}</main>
          <MobileNav />
        </AuthProvider>
      </body>
    </html>
  );
}
