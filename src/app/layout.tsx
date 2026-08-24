import type { Metadata } from "next";
import { Assistant, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AppHeader } from "@/components/AppHeader";
import { MobileNav } from "@/components/MobileNav";
import { AuthProvider } from "@/components/AuthProvider";
import { UpgradeGateProvider } from "@/components/UpgradeGate";
import { Analytics } from "@vercel/analytics/next";

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

export default function RootLayout({ children, modal }: LayoutProps<"/">) {
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
          {/* One modal for the whole app: the bookmark button alone renders
              146 times on the feed, and each of those can hit a plan limit. */}
          <UpgradeGateProvider>
            <AppHeader />
            <main className="flex-1 pb-20 md:pb-0">{children}</main>
            {/* The tender drawer. Empty on every route but an intercepted
                /deal/[id] — see src/app/@modal/default.tsx. */}
            {modal}
            <MobileNav />
          </UpgradeGateProvider>
        </AuthProvider>
        {/* Vercel Web Analytics: visitors and page views. Renders nothing and
            only loads its script on a Vercel deployment, so local development
            and CI are unaffected.

            Complementary to /api/events rather than a replacement — that
            records product intent (pricing_view, upgrade_click, limit_hit) in
            our own database, which is what the funnel on /admin is built from.
            This answers the question that one cannot: how many people arrive
            at all. */}
        <Analytics />
      </body>
    </html>
  );
}
