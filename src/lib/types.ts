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

export type BadgeKind =
  | "motivated_seller" // מוכר לחוץ
  | "deadline_soon" // זמן קצר להגשה
  | "below_average" // מתחת לשומה (below the official appraisal)
  | "rezoning_potential"; // פוטנציאל השבחה (rezoning upside)

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

  // land
  propertyType: PropertyType; // סוג הקרקע
  zoning: Zoning; // ייעוד תכנוני
  areaSqm: number; // land area in m²
  buildingRights?: string; // זכויות בנייה, e.g. "יח״ד: 8 · עד 4 קומות"

  // financials
  askingPrice: number; // מחיר מבוקש / מינימום
  submissionDeadline?: string; // ISO — מועד אחרון להגשה

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

  // enrichment
  comps: HistoricalTransaction[];
  areaAvgPricePerSqm: number; // ₪ per m² of LAND in the area
}

export type AlertChannel = "whatsapp" | "telegram" | "email";
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
    minScore?: number;
  };
  channels: AlertChannel[];
  frequency: AlertFrequency;
  isActive: boolean;
  triggeredThisMonth: number;
}
