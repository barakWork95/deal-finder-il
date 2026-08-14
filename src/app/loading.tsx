import { PageLoader } from "@/components/LogoLoader";

// Shown while the feed's tender queries run on the server.
export default function Loading() {
  return <PageLoader label="טוען מכרזים…" />;
}
