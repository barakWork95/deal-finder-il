// Types mirror the PostgreSQL schema from the technical spec.
// Swapping mock data for Supabase later means implementing these same shapes.

// ── LAND-focused platform ──────────────────────────────────
// The product surfaces plots of land / tracts (מגרשים וקרקעות),
// not built apartments. Zoning (ייעוד) and building rights
// (זכויות בנייה) replace rooms/floors.

export type DealType =
  | "rami_tender" // מכרז רמ"י (primary — Israel Land Authority land tenders)
  | "foreclosure" // כינוס נכסים על קרקע
  | "private_sale" // מכירה פרטית
  | "inheritance" // ירושה
  | "price_drop" // ירידת מחיר
  | "other";

export type DealStatus = "active" | "expired" | "sold" | "withdrawn";

// Category of the land being sold (סוג הקרקע).
export type PropertyType =
  | "מגרש למגורים"
  | "מגרש מסחרי"
  | "מגרש לתעשייה"
  | "קרקע חקלאית"
  | "מתחם להשבחה"
  | "נחלה";

// Planning designation (ייעוד תכנוני).
export type Zoning =
  | "מגורים"
  | "מסחר"
  | "תעשייה ומלאכה"
  | "חקלאי"
  | "מעורב"
  | "תיירות"
  | "מבני ציבור";

/**
 * Where a tender sits in its own timeline. Lives here with the other domain
 * unions; the logic that derives it from the dates is in tender-phase.ts,
 * which is also where the labels are. Deliberately NOT `deals.status` — that
 * column is our lifecycle (active/expired/sold/withdrawn) and every read
 * filters on it.
 */
export type TenderPhase = "not_started" | "open" | "closing_soon" | "closed";

export type BadgeKind =
  | "motivated_seller" // מוכר לחוץ
  | "deadline_soon" // זמן קצר להגשה
  | "below_average" // מתחת לשומה (below the official appraisal)
  | "rezoning_potential" // פוטנציאל השבחה (rezoning upside)
  | "not_started"; // טרם החל — published, bidding has not opened yet

export interface HistoricalTransaction {
  id: string;
  city: string;
  street: string;
  houseNumber: string;
  gush?: string;
  helka?: string;
  propertyType: PropertyType;
  zoning?: Zoning;
  areaSqm: number;
  salePrice: number;
  saleDate: string; // ISO date
  pricePerSqm: number; // ₪ per m² of LAND
}

export interface Deal {
  id: string;
  sourceName: string; // e.g. 'לשכת ההוצאה לפועל', 'רמ"י'
  dealType: DealType;
  status: DealStatus;

  // address (Hebrew)
  rawAddress: string;
  city: string;
  street: string;
  houseNumber: string;
  neighborhood?: string;
  gush?: string;
  helka?: string;
  tatHelka?: string;
  lat: number;
  lng: number;
  /**
   * How the coordinates were resolved (db/geocode-deals.mjs):
   * "parcel" = centroid of the registered גוש/חלקה, "city" = settlement
   * centroid only. The map must not present a settlement centroid as the plot.
   */
  geoPrecision?: "parcel" | "city";

  // land
  propertyType: PropertyType; // סוג הקרקע
  zoning: Zoning; // ייעוד תכנוני
  areaSqm: number; // land area in m²
  buildingRights?: string; // זכויות בנייה, e.g. "יח״ד: 8 · עד 4 קומות"

  // financials
  askingPrice: number; // מחיר מבוקש / מינימום
  submissionDeadline?: string; // ISO — מועד אחרון להגשה (רמ"י SgiraDate)
  /**
   * ISO — when bidding opens (רמ"י PtichaDate). A tender published but not yet
   * open is "טרם החל"; see tenderPhase(), which derives that rather than
   * trusting a stored flag that would go stale the moment the date passes.
   */
  submissionOpensAt?: string;
  /** Raw רמ"י StatusMichraz (1 מפורסם, 2 פתוח להגשת הצעות, …), as reported. */
  sourceStatus?: number;

  // computed
  estMarketValue: number;
  /**
   * Gap vs. the official appraisal (שומה), in percent. Positive = entry cost is
   * below the appraisal. NOT a guaranteed discount: רמ"י tenders are
   * competitive, so final prices land higher than the opening minimum bid.
   */
  discountPct: number;
  dealScore: number; // 0–100

  badges: BadgeKind[];
  rawDocumentUrl?: string;
  firstSeenAt: string;

  // tender cost breakdown (רמ"י): entry cost = minBid + developmentCosts
  minBid?: number;
  developmentCosts?: number;

  // enrichment
  comps: HistoricalTransaction[];
  areaAvgPricePerSqm: number; // ₪ per m² of LAND in the area

  /**
   * Median historical premium of winning bids over the minimum bid for this
   * city+zoning, as a ratio (3.69 = +369%). Undefined when too few past
   * tenders back it. `winningPremiumN` is the sample size behind it.
   */
  winningPremium?: number;
  winningPremiumN?: number;
  /** minBid × (1 + winningPremium) + developmentCosts — what a bidder likely pays. */
  expectedWinningPrice?: number;
  /** Gap of expectedWinningPrice vs the שומה, in percent. Positive = still below. */
  expectedGapPct?: number;
}

// WhatsApp + email only — Telegram was dropped from the product.
export type AlertChannel = "whatsapp" | "email";
export type AlertFrequency = "instant" | "daily" | "weekly";

export interface Alert {
  id: string;
  name: string;
  filters: {
    cities?: string[];
    maxPrice?: number;
    minPrice?: number;
    minDiscountPct?: number;
    dealTypes?: DealType[];
    zonings?: Zoning[];
    minScore?: number;
    /** Empty/absent = every phase, matching how the feed's chips behave. */
    phases?: TenderPhase[];
  };
  channels: AlertChannel[];
  frequency: AlertFrequency;
  isActive: boolean;
  /**
   * Send a second message when a matching טרם החל tender opens for bidding.
   * Defaults to on: about 150 of 355 active tenders are not yet open, so
   * without it the discovery alert is often the only word you get — weeks
   * before you can act on it.
   */
  notifyOnOpen?: boolean;
  triggeredThisMonth: number;
}

/**
 * Billing plan. `user_contacts.tier` (db/011_notifications.sql) is the source
 * of truth and the admin dashboard is what sets it — see src/lib/admin.ts.
 * Declared here rather than in a repository module so client components can
 * name it without importing anything server-only.
 */
export type PlanTier = "free" | "pro";
