import type { Deal, HistoricalTransaction, Alert, PropertyType, Zoning } from "./types";

// Build comparable LAND transactions around a target ₪/m² of land.
function buildComps(
  city: string,
  street: string,
  propertyType: PropertyType,
  zoning: Zoning,
  avgPerSqm: number,
  seed: number,
): HistoricalTransaction[] {
  const months = [4, 9, 13, 18, 24];
  return months.map((mAgo, i) => {
    const area = 280 + ((seed + i * 40) % 900); // land parcels vary widely
    const jitter = ((seed * (i + 1)) % 11) / 100 - 0.05; // ±5%
    const perSqm = Math.round(avgPerSqm * (1 + jitter));
    const price = Math.round((area * perSqm) / 1000) * 1000;
    const date = new Date(2026, 7 - mAgo, 12 - i);
    return {
      id: `${city}-${street}-h${i}`,
      city,
      street,
      houseNumber: String(10 + ((seed + i) % 80)),
      propertyType,
      zoning,
      areaSqm: area,
      salePrice: price,
      saleDate: date.toISOString(),
      pricePerSqm: perSqm,
    };
  });
}

interface DealSeed {
  id: string;
  sourceName: string;
  dealType: Deal["dealType"];
  city: string;
  block: string; // רובע / אזור
  gush: string;
  helka: string;
  tatHelka: string;
  lat: number;
  lng: number;
  propertyType: PropertyType;
  zoning: Zoning;
  buildingRights?: string;
  areaSqm: number;
  askingPrice: number;
  deadlineDaysFromToday: number | null;
  avgPerSqm: number; // area land ₪/m² benchmark
  badges: Deal["badges"];
  status?: Deal["status"];
}

const TODAY = new Date(2026, 7, 9); // 2026-08-09

function isoDaysFromToday(days: number): string {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

const seeds: DealSeed[] = [
  {
    id: "l-001",
    sourceName: 'רשות מקרקעי ישראל (רמ"י)',
    dealType: "rami_tender",
    city: "חריש",
    block: "מתחם המייסדים",
    gush: "10098",
    helka: "42",
    tatHelka: "3",
    lat: 32.462,
    lng: 35.045,
    propertyType: "מגרש למגורים",
    zoning: "מגורים",
    buildingRights: "עד 6 יח״ד · 4 קומות",
    areaSqm: 540,
    askingPrice: 2_650_000,
    deadlineDaysFromToday: 9,
    avgPerSqm: 5_800,
    badges: ["below_average", "deadline_soon"],
  },
  {
    id: "l-002",
    sourceName: 'רשות מקרקעי ישראל (רמ"י)',
    dealType: "rami_tender",
    city: "שדרות",
    block: "נאות השרון",
    gush: "1934",
    helka: "18",
    tatHelka: "7",
    lat: 31.524,
    lng: 34.596,
    propertyType: "מגרש למגורים",
    zoning: "מגורים",
    buildingRights: "צמוד קרקע · עד 2 יח״ד",
    areaSqm: 500,
    askingPrice: 980_000,
    deadlineDaysFromToday: 6,
    avgPerSqm: 2_200,
    badges: ["below_average", "deadline_soon"],
  },
  {
    id: "l-003",
    sourceName: "כונס נכסים — עו\"ד לוי",
    dealType: "foreclosure",
    city: "נתיבות",
    block: "רמות",
    gush: "39548",
    helka: "60",
    tatHelka: "1",
    lat: 31.421,
    lng: 34.588,
    propertyType: "מגרש למגורים",
    zoning: "מגורים",
    buildingRights: "עד 2 יח״ד",
    areaSqm: 470,
    askingPrice: 760_000,
    deadlineDaysFromToday: 4,
    avgPerSqm: 2_100,
    badges: ["below_average", "motivated_seller", "deadline_soon"],
  },
  {
    id: "l-004",
    sourceName: "מכירה פרטית",
    dealType: "private_sale",
    city: "גדרה",
    block: "מזרח",
    gush: "3874",
    helka: "9",
    tatHelka: "0",
    lat: 31.813,
    lng: 34.779,
    propertyType: "קרקע חקלאית",
    zoning: "חקלאי",
    buildingRights: "ללא זכויות בנייה כיום",
    areaSqm: 6_000,
    askingPrice: 4_950_000,
    deadlineDaysFromToday: null,
    avgPerSqm: 950,
    badges: ["rezoning_potential", "below_average"],
  },
  {
    id: "l-005",
    sourceName: 'רשות מקרקעי ישראל (רמ"י)',
    dealType: "rami_tender",
    city: "ראש העין",
    block: "מזרח (פסגות אפק)",
    gush: "5502",
    helka: "120",
    tatHelka: "12",
    lat: 32.083,
    lng: 34.968,
    propertyType: "מגרש למגורים",
    zoning: "מגורים",
    buildingRights: "עד 4 קומות · 4 יח״ד",
    areaSqm: 320,
    askingPrice: 2_720_000,
    deadlineDaysFromToday: 11,
    avgPerSqm: 9_200,
    badges: ["deadline_soon"],
  },
  {
    id: "l-006",
    sourceName: 'רשות מקרקעי ישראל (רמ"י)',
    dealType: "rami_tender",
    city: "כרמיאל",
    block: "פארק תעשייה",
    gush: "18942",
    helka: "5",
    tatHelka: "2",
    lat: 32.916,
    lng: 35.292,
    propertyType: "מגרש מסחרי",
    zoning: "מסחר",
    buildingRights: "עד 2 קומות מסחר",
    areaSqm: 720,
    askingPrice: 2_450_000,
    deadlineDaysFromToday: 16,
    avgPerSqm: 3_500,
    badges: [],
  },
  {
    id: "l-007",
    sourceName: 'רשות מקרקעי ישראל (רמ"י)',
    dealType: "rami_tender",
    city: "יבנה",
    block: "נאות שמיר",
    gush: "5170",
    helka: "88",
    tatHelka: "5",
    lat: 31.878,
    lng: 34.739,
    propertyType: "מגרש למגורים",
    zoning: "מגורים",
    buildingRights: "עד 8 יח״ד · 5 קומות",
    areaSqm: 480,
    askingPrice: 3_100_000,
    deadlineDaysFromToday: 7,
    avgPerSqm: 8_400,
    badges: ["below_average", "deadline_soon"],
  },
  {
    id: "l-008",
    sourceName: "ירושה — נכס עיזבון",
    dealType: "inheritance",
    city: "כפר יונה",
    block: "החורש",
    gush: "8148",
    helka: "31",
    tatHelka: "4",
    lat: 32.317,
    lng: 34.933,
    propertyType: "מגרש למגורים",
    zoning: "מגורים",
    buildingRights: "צמוד קרקע · 2 יח״ד",
    areaSqm: 500,
    askingPrice: 3_650_000,
    deadlineDaysFromToday: null,
    avgPerSqm: 8_600,
    badges: ["below_average", "motivated_seller"],
  },
  {
    id: "l-009",
    sourceName: "מכירה פרטית",
    dealType: "private_sale",
    city: "אופקים",
    block: "צפון",
    gush: "39610",
    helka: "14",
    tatHelka: "0",
    lat: 31.317,
    lng: 34.62,
    propertyType: "מתחם להשבחה",
    zoning: "חקלאי",
    buildingRights: "בתהליך תב״ע למגורים",
    areaSqm: 10_000,
    askingPrice: 3_400_000,
    deadlineDaysFromToday: null,
    avgPerSqm: 380,
    badges: ["rezoning_potential", "below_average"],
  },
  {
    id: "l-010",
    sourceName: 'רשות מקרקעי ישראל (רמ"י)',
    dealType: "rami_tender",
    city: "קריית גת",
    block: "כרמי גת",
    gush: "1740",
    helka: "205",
    tatHelka: "9",
    lat: 31.61,
    lng: 34.77,
    propertyType: "מגרש למגורים",
    zoning: "מגורים",
    buildingRights: "עד 6 יח״ד · 4 קומות",
    areaSqm: 360,
    askingPrice: 1_560_000,
    deadlineDaysFromToday: 13,
    avgPerSqm: 4_600,
    badges: ["below_average"],
  },
  {
    id: "l-011",
    sourceName: 'רשות מקרקעי ישראל (רמ"י)',
    dealType: "rami_tender",
    city: "דימונה",
    block: "אזור תעשייה",
    gush: "39030",
    helka: "3",
    tatHelka: "1",
    lat: 31.066,
    lng: 35.032,
    propertyType: "מגרש לתעשייה",
    zoning: "תעשייה ומלאכה",
    buildingRights: "מבנה תעשייה · 40% בנייה",
    areaSqm: 1_200,
    askingPrice: 1_380_000,
    deadlineDaysFromToday: 22,
    avgPerSqm: 1_250,
    badges: [],
  },
  {
    id: "l-012",
    sourceName: "מכירה פרטית",
    dealType: "private_sale",
    city: "פרדס חנה-כרכור",
    block: "מרכז",
    gush: "10082",
    helka: "77",
    tatHelka: "0",
    lat: 32.472,
    lng: 34.973,
    propertyType: "מתחם להשבחה",
    zoning: "מעורב",
    buildingRights: "ייעוד מעורב מגורים+מסחר",
    areaSqm: 2_500,
    askingPrice: 7_400_000,
    deadlineDaysFromToday: null,
    avgPerSqm: 3_100,
    badges: ["rezoning_potential"],
  },
  {
    id: "l-013",
    sourceName: "מכירה פרטית",
    dealType: "private_sale",
    city: "גדרה",
    block: "מערב",
    gush: "3880",
    helka: "22",
    tatHelka: "0",
    lat: 31.807,
    lng: 34.77,
    propertyType: "קרקע חקלאית",
    zoning: "חקלאי",
    areaSqm: 5_000,
    askingPrice: 4_200_000,
    deadlineDaysFromToday: null,
    avgPerSqm: 900,
    badges: [],
    status: "sold",
  },
];

function buildDeal(s: DealSeed, idx: number): Deal {
  const comps = buildComps(s.city, s.block, s.propertyType, s.zoning, s.avgPerSqm, idx + 3);
  const estMarketValue = Math.round((s.areaSqm * s.avgPerSqm) / 1000) * 1000;
  const discountPct = Math.round(((estMarketValue - s.askingPrice) / estMarketValue) * 1000) / 10;

  // Rule-based "Deal Score v0" for LAND: discount + tender urgency +
  // deal-type + rezoning upside.
  const discountScore = Math.max(0, Math.min(55, discountPct * 2.4));
  const urgency =
    s.deadlineDaysFromToday === null ? 6 : s.deadlineDaysFromToday <= 5 ? 18 : s.deadlineDaysFromToday <= 14 ? 12 : 8;
  const typeBoost =
    s.dealType === "rami_tender" ? 10 : s.dealType === "foreclosure" ? 8 : s.dealType === "inheritance" ? 5 : 3;
  const rezoningBoost = s.badges.includes("rezoning_potential") ? 14 : 0;
  const sellerBoost = s.badges.includes("motivated_seller") ? 8 : 0;
  const dealScore =
    s.status === "sold"
      ? 0
      : Math.max(0, Math.min(99, Math.round(discountScore + urgency + typeBoost + rezoningBoost + sellerBoost)));

  return {
    id: s.id,
    sourceName: s.sourceName,
    dealType: s.dealType,
    status: s.status ?? "active",
    rawAddress: `${s.propertyType}, ${s.block}, ${s.city}`,
    city: s.city,
    street: s.block,
    houseNumber: "",
    neighborhood: s.block,
    gush: s.gush,
    helka: s.helka,
    tatHelka: s.tatHelka,
    lat: s.lat,
    lng: s.lng,
    propertyType: s.propertyType,
    zoning: s.zoning,
    areaSqm: s.areaSqm,
    buildingRights: s.buildingRights,
    askingPrice: s.askingPrice,
    submissionDeadline:
      s.deadlineDaysFromToday === null ? undefined : isoDaysFromToday(s.deadlineDaysFromToday),
    estMarketValue,
    discountPct,
    dealScore,
    badges: s.badges,
    rawDocumentUrl: "#",
    firstSeenAt: isoDaysFromToday(-((idx % 7) + 1)),
    comps,
    areaAvgPricePerSqm: s.avgPerSqm,
  };
}

export const DEALS: Deal[] = seeds.map(buildDeal);

export function getDeal(id: string): Deal | undefined {
  return DEALS.find((d) => d.id === id);
}

export const CITIES: string[] = Array.from(new Set(DEALS.map((d) => d.city))).sort((a, b) =>
  a.localeCompare(b, "he"),
);

export const ALERTS: Alert[] = [
  {
    id: "a-1",
    name: "מגרשים בשרון מתחת ל-3M",
    filters: { cities: ["כפר יונה", "פרדס חנה-כרכור"], maxPrice: 3_000_000, minDiscountPct: 10, dealTypes: ["rami_tender", "private_sale"] },
    channels: ["whatsapp", "email"],
    frequency: "instant",
    isActive: true,
    triggeredThisMonth: 5,
  },
  {
    id: "a-2",
    name: "קרקע להשבחה — ציון 85+",
    filters: { minScore: 85, dealTypes: ["private_sale"] },
    channels: ["telegram"],
    frequency: "daily",
    isActive: true,
    triggeredThisMonth: 9,
  },
  {
    id: "a-3",
    name: 'מכרזי רמ"י בדרום',
    filters: { cities: ["שדרות", "נתיבות", "אופקים"], dealTypes: ["rami_tender"] },
    channels: ["email"],
    frequency: "weekly",
    isActive: false,
    triggeredThisMonth: 0,
  },
];
