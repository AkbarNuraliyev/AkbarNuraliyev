/**
 * SAFI Demo — fictional demonstration master data.
 * Company, farm and customer names are invented; prices and volumes are
 * illustrative assumptions, not verified figures.
 */

export const REGIONS = [
  "Tashkent region", "Samarkand", "Bukhara", "Fergana", "Andijan", "Namangan", "Kashkadarya",
  "Surkhandarya", "Jizzakh", "Syrdarya", "Navoi", "Khorezm",
];

export const SUPPLIERS = [
  { code: "SUP01", name: "Bahor Broiler LLC (demo)", region: "Tashkent region", type: "INTEGRATOR", farms: 5, price: 21500 },
  { code: "SUP02", name: "Chorvoq Parranda (demo)", region: "Tashkent region", type: "FARM", farms: 3, price: 21000 },
  { code: "SUP03", name: "Navro'z Agro Poultry (demo)", region: "Samarkand", type: "INTEGRATOR", farms: 4, price: 21200 },
  { code: "SUP04", name: "Yashil Vodiy Fermer (demo)", region: "Fergana", type: "FARM", farms: 3, price: 20800 },
  { code: "SUP05", name: "Zarafshon Broiler Invest (demo)", region: "Samarkand", type: "INTEGRATOR", farms: 4, price: 21300 },
  { code: "SUP06", name: "Oltin Qanot Farm (demo)", region: "Bukhara", type: "FARM", farms: 2, price: 20900 },
  { code: "SUP07", name: "Qashqa Agro (demo)", region: "Kashkadarya", type: "FARM", farms: 3, price: 20700 },
  { code: "SUP08", name: "Andijon Broiler Group (demo)", region: "Andijan", type: "INTEGRATOR", farms: 4, price: 21100 },
  { code: "SUP09", name: "Namangan Poultry Union (demo)", region: "Namangan", type: "TRADER", farms: 3, price: 21600 },
  { code: "SUP10", name: "Sirdaryo Fermer (demo)", region: "Syrdarya", type: "FARM", farms: 2, price: 20600 },
  { code: "SUP11", name: "Jizzax Parranda (demo)", region: "Jizzakh", type: "FARM", farms: 2, price: 20500 },
  { code: "SUP12", name: "Navoiy Agro Broiler (demo)", region: "Navoi", type: "FARM", farms: 2, price: 20800 },
  { code: "SUP13", name: "Xorazm Broiler (demo)", region: "Khorezm", type: "FARM", farms: 2, price: 20400 },
  { code: "SUP14", name: "Surxon Parranda (demo)", region: "Surkhandarya", type: "FARM", farms: 2, price: 20300 },
  { code: "SUP15", name: "Ohangaron Poultry (demo)", region: "Tashkent region", type: "FARM", farms: 3, price: 21400 },
  { code: "SUP16", name: "Chirchiq Broiler (demo)", region: "Tashkent region", type: "FARM", farms: 2, price: 21300 },
  { code: "SUP17", name: "Zomin Fermer Xo'jaligi (demo)", region: "Jizzakh", type: "FARM", farms: 2, price: 20600 },
  { code: "SUP18", name: "Urgut Agro (demo)", region: "Samarkand", type: "FARM", farms: 2, price: 20900 },
  { code: "SUP19", name: "Qo'qon Parranda (demo)", region: "Fergana", type: "FARM", farms: 1, price: 20700 },
  { code: "SUP20", name: "Termiz Broiler (demo)", region: "Surkhandarya", type: "FARM", farms: 1, price: 20200 },
] as const;

export const FIRST = ["Aziz", "Bekzod", "Dilshod", "Farhod", "Jasur", "Laziz", "Nodir", "Otabek", "Rustam", "Sardor", "Shavkat", "Umid", "Zafar", "Malika", "Nigora", "Dilnoza", "Gulnora", "Kamola"];
export const LAST = ["Karimov", "Rahimov", "Tursunov", "Yusupov", "Aliyev", "Qodirov", "Saidov", "Nazarov", "Ergashev", "Mirzayev", "Xolmatov", "Sobirov"];

// share = expected yield share of live weight; cut = only from cut-up birds; whole = only from whole-sold birds
export interface ProductSeed {
  sku: string;
  name: string;
  cat: "CHILLED" | "FROZEN" | "SEMI" | "RTC" | "PROCESSED" | "BYPRODUCT";
  price: number;
  shelf: number; // hours
  plu: string;
  variable?: boolean;
  net?: number;
  yieldPct?: number;
  min?: number;
  storage?: "CHILLED" | "FROZEN";
  desc?: string;
  ingredients?: string;
}

export const PRODUCTS: ProductSeed[] = [
  { sku: "CH-WHOLE", name: "Whole broiler carcass, chilled", cat: "CHILLED", price: 32000, shelf: 72, plu: "10001", yieldPct: 72, min: 1500, desc: "Grade A gutted broiler carcass with neck, chilled 0…+4 °C." },
  { sku: "CH-HALF", name: "Broiler half carcass, chilled", cat: "CHILLED", price: 33000, shelf: 72, plu: "10002", yieldPct: 36 },
  { sku: "CH-BRF", name: "Chicken breast fillet, chilled", cat: "CHILLED", price: 58000, shelf: 72, plu: "10003", yieldPct: 21, min: 1200, desc: "Skinless, boneless breast fillet." },
  { sku: "CH-BRBI", name: "Chicken breast bone-in, chilled", cat: "CHILLED", price: 44000, shelf: 72, plu: "10004", yieldPct: 27 },
  { sku: "CH-INF", name: "Chicken inner fillet, chilled", cat: "CHILLED", price: 56000, shelf: 72, plu: "10005", yieldPct: 3.5 },
  { sku: "CH-THI", name: "Chicken thighs bone-in, chilled", cat: "CHILLED", price: 36000, shelf: 72, plu: "10006", yieldPct: 13.5, min: 800 },
  { sku: "CH-THF", name: "Chicken thigh fillet, boneless, chilled", cat: "CHILLED", price: 49000, shelf: 72, plu: "10007", yieldPct: 9 },
  { sku: "CH-DRU", name: "Chicken drumsticks, chilled", cat: "CHILLED", price: 38000, shelf: 72, plu: "10008", yieldPct: 10, min: 700 },
  { sku: "CH-WNG", name: "Chicken wings, chilled", cat: "CHILLED", price: 34000, shelf: 72, plu: "10009", yieldPct: 7.8, min: 500 },
  { sku: "CH-LEG", name: "Chicken leg quarter, chilled", cat: "CHILLED", price: 35000, shelf: 72, plu: "10010", yieldPct: 23.5 },
  { sku: "CH-LGF", name: "Chicken leg fillet, chilled", cat: "CHILLED", price: 47000, shelf: 72, plu: "10011", yieldPct: 16 },
  { sku: "CH-BCK", name: "Chicken back & frame (soup set), chilled", cat: "CHILLED", price: 9000, shelf: 72, plu: "10012", yieldPct: 9 },
  { sku: "CH-MNC", name: "Chicken mince, chilled", cat: "CHILLED", price: 30000, shelf: 48, plu: "10013", yieldPct: 2, desc: "Mechanically separated and trimmed chicken meat." },
  { sku: "BP-LIV", name: "Chicken liver, chilled", cat: "BYPRODUCT", price: 28000, shelf: 48, plu: "10021", yieldPct: 2, min: 150 },
  { sku: "BP-HRT", name: "Chicken hearts, chilled", cat: "BYPRODUCT", price: 45000, shelf: 48, plu: "10022", yieldPct: 0.5 },
  { sku: "BP-GIZ", name: "Chicken gizzards, chilled", cat: "BYPRODUCT", price: 26000, shelf: 48, plu: "10023", yieldPct: 1.5 },
  { sku: "BP-NCK", name: "Chicken necks, chilled", cat: "BYPRODUCT", price: 12000, shelf: 48, plu: "10024", yieldPct: 2.5 },
  { sku: "BP-FEET", name: "Chicken feet (paws), chilled", cat: "BYPRODUCT", price: 15000, shelf: 48, plu: "10025", yieldPct: 3.5 },
  { sku: "FR-WHOLE", name: "Whole broiler carcass, frozen", cat: "FROZEN", price: 29000, shelf: 4320, plu: "20001", storage: "FROZEN", yieldPct: 72, min: 2000 },
  { sku: "FR-BRF", name: "Chicken breast fillet, frozen", cat: "FROZEN", price: 52000, shelf: 4320, plu: "20002", storage: "FROZEN", yieldPct: 21 },
  { sku: "FR-THI", name: "Chicken thighs, frozen", cat: "FROZEN", price: 32000, shelf: 4320, plu: "20003", storage: "FROZEN", yieldPct: 13.5 },
  { sku: "FR-DRU", name: "Chicken drumsticks, frozen", cat: "FROZEN", price: 34000, shelf: 4320, plu: "20004", storage: "FROZEN", yieldPct: 10 },
  { sku: "FR-WNG", name: "Chicken wings, frozen", cat: "FROZEN", price: 30000, shelf: 4320, plu: "20005", storage: "FROZEN", yieldPct: 7.8 },
  { sku: "FR-LEG", name: "Chicken leg quarter, frozen", cat: "FROZEN", price: 31000, shelf: 4320, plu: "20006", storage: "FROZEN", yieldPct: 23.5 },
  { sku: "FR-MNC", name: "Chicken mince, frozen 1 kg", cat: "FROZEN", price: 27000, shelf: 4320, plu: "20007", storage: "FROZEN", variable: false, net: 1, yieldPct: 2 },
  { sku: "FR-LIV", name: "Chicken liver, frozen 0.5 kg", cat: "FROZEN", price: 25000, shelf: 4320, plu: "20008", storage: "FROZEN", variable: false, net: 0.5 },
  { sku: "FR-BCK", name: "Chicken frames, frozen", cat: "FROZEN", price: 7500, shelf: 4320, plu: "20009", storage: "FROZEN" },
  { sku: "SF-CUT", name: "Chicken cutlets (kotlet), 0.5 kg", cat: "SEMI", price: 36000, shelf: 120, plu: "30001", variable: false, net: 0.5, ingredients: "Chicken meat 78%, onion, bread crumbs, egg, salt, black pepper." },
  { sku: "SF-SHA", name: "Chicken shashlik, marinated", cat: "SEMI", price: 52000, shelf: 96, plu: "30002", ingredients: "Chicken thigh fillet 88%, onion, vinegar, salt, coriander, paprika." },
  { sku: "SF-NUG", name: "Chicken nuggets, 0.4 kg", cat: "SEMI", price: 38000, shelf: 4320, plu: "30003", variable: false, net: 0.4, storage: "FROZEN", ingredients: "Chicken breast 65%, batter (wheat flour, water, starch), breadcrumbs, salt, spices." },
  { sku: "SF-BRG", name: "Chicken burger patties, 4×100 g", cat: "SEMI", price: 34000, shelf: 4320, plu: "30004", variable: false, net: 0.4, storage: "FROZEN", ingredients: "Chicken meat 82%, onion, salt, spices." },
  { sku: "SF-LUL", name: "Chicken lula kebab, marinated", cat: "SEMI", price: 46000, shelf: 96, plu: "30005", ingredients: "Chicken mince 85%, onion, coriander, salt, cumin." },
  { sku: "SF-PEL", name: "Chicken dumplings (chuchvara), 0.8 kg", cat: "SEMI", price: 32000, shelf: 4320, plu: "30006", variable: false, net: 0.8, storage: "FROZEN", ingredients: "Dough (wheat flour, water, egg), chicken meat 45%, onion, salt, pepper." },
  { sku: "RC-TAB", name: "Chicken tabaka, marinated", cat: "RTC", price: 39000, shelf: 96, plu: "40001", ingredients: "Spatchcocked broiler 92%, garlic, salt, pepper, oil." },
  { sku: "RC-DRM", name: "Drumsticks in BBQ marinade", cat: "RTC", price: 41000, shelf: 96, plu: "40002", ingredients: "Chicken drumsticks 87%, BBQ marinade (tomato, sugar, paprika, garlic, salt)." },
  { sku: "RC-WBQ", name: "BBQ chicken wings, marinated", cat: "RTC", price: 39000, shelf: 96, plu: "40003", ingredients: "Chicken wings 88%, honey-soy marinade." },
  { sku: "RC-CBL", name: "Chicken cordon bleu, 2 pcs", cat: "RTC", price: 44000, shelf: 120, plu: "40004", variable: false, net: 0.35, ingredients: "Chicken breast 60%, cheese, turkey ham, breadcrumbs, egg." },
  { sku: "RC-STK", name: "Marinated chicken breast steak", cat: "RTC", price: 61000, shelf: 96, plu: "40005", ingredients: "Chicken breast fillet 92%, olive oil, herbs, salt." },
  { sku: "PR-SOS", name: "Chicken sausages (sosiski), 0.5 kg", cat: "PROCESSED", price: 33000, shelf: 360, plu: "50001", variable: false, net: 0.5, ingredients: "Chicken meat 70%, water, milk powder, salt, spices, casing." },
  { sku: "PR-KOL", name: "Boiled chicken sausage (kolbasa)", cat: "PROCESSED", price: 42000, shelf: 480, plu: "50002", ingredients: "Chicken meat 75%, water, egg, salt, spices." },
  { sku: "PR-SML", name: "Smoked chicken legs", cat: "PROCESSED", price: 47000, shelf: 240, plu: "50003", ingredients: "Chicken legs 95%, salt, spices; hot smoked." },
  { sku: "PR-RUL", name: "Chicken roll (rulet), baked", cat: "PROCESSED", price: 55000, shelf: 240, plu: "50004", ingredients: "Chicken meat 85%, carrot, garlic, gelatin, salt, spices." },
  { sku: "PR-PAT", name: "Chicken liver pâté, 0.2 kg", cat: "PROCESSED", price: 18000, shelf: 360, plu: "50005", variable: false, net: 0.2, ingredients: "Chicken liver 60%, butter, onion, carrot, salt." },
  { sku: "PR-HAM", name: "Chicken ham", cat: "PROCESSED", price: 52000, shelf: 360, plu: "50006", ingredients: "Chicken breast 80%, water, salt, spices." },
];

/** Output mix used by the production simulation (share of live input weight). */
export const CUT_MIX: { sku: string; share: number; frozenSku?: string; frozenPct?: number }[] = [
  { sku: "BP-NCK", share: 0.025 },
  { sku: "CH-BRF", share: 0.2, frozenSku: "FR-BRF", frozenPct: 0.12 },
  { sku: "RC-STK", share: 0.01 },
  { sku: "CH-INF", share: 0.035 },
  { sku: "CH-THI", share: 0.1, frozenSku: "FR-THI", frozenPct: 0.1 },
  { sku: "SF-SHA", share: 0.02 },
  { sku: "CH-THF", share: 0.015 },
  { sku: "CH-DRU", share: 0.09, frozenSku: "FR-DRU", frozenPct: 0.1 },
  { sku: "RC-DRM", share: 0.01 },
  { sku: "CH-WNG", share: 0.068, frozenSku: "FR-WNG", frozenPct: 0.1 },
  { sku: "RC-WBQ", share: 0.01 },
  { sku: "CH-BCK", share: 0.09, frozenSku: "FR-BCK", frozenPct: 0.15 },
  { sku: "CH-MNC", share: 0.015 },
  { sku: "SF-LUL", share: 0.005 },
];
export const CUT_BONE_WASTE = 0.027; // deboning losses (Other waste)
export const WHOLE_YIELD = 0.72;
export const GIBLETS: { sku: string; share: number }[] = [
  { sku: "BP-LIV", share: 0.02 },
  { sku: "BP-HRT", share: 0.005 },
  { sku: "BP-GIZ", share: 0.015 },
  { sku: "BP-FEET", share: 0.035 },
];
export const WASTE: { cat: string; share: number }[] = [
  { cat: "Feathers", share: 0.065 },
  { cat: "Blood", share: 0.035 },
  { cat: "Inedible offal", share: 0.07 },
  { cat: "Heads", share: 0.025 },
];

export const CUSTOMERS = [
  { code: "C001", name: "Navbahor Restaurant Group (demo)", type: "HORECA", pl: "HoReCa contract 2026", scale: 0.6 },
  { code: "C002", name: "Silk Road Catering (demo)", type: "HORECA", pl: "HoReCa contract 2026", scale: 0.8 },
  { code: "C003", name: "Afrosiyob Kitchen (demo)", type: "HORECA", pl: "HoReCa contract 2026", scale: 0.4 },
  { code: "C004", name: "Plov Markazi Demo Café", type: "HORECA", pl: "HoReCa contract 2026", scale: 0.5 },
  { code: "C005", name: "Bodomzor Grill House (demo)", type: "HORECA", pl: "HoReCa contract 2026", scale: 0.35 },
  { code: "C006", name: "Mirzo Hotel & Banquets (demo)", type: "HORECA", pl: "HoReCa contract 2026", scale: 0.45 },
  { code: "C007", name: "Baraka Supermarkets (demo)", type: "RETAIL_CHAIN", pl: "Retail chains 2026", scale: 2.2 },
  { code: "C008", name: "Mahalla Market Chain (demo)", type: "RETAIL_CHAIN", pl: "Retail chains 2026", scale: 1.8 },
  { code: "C009", name: "Yangi Kun Hypermarket (demo)", type: "RETAIL_CHAIN", pl: "Retail chains 2026", scale: 2.0 },
  { code: "C010", name: "Osiyo Retail (demo)", type: "RETAIL_CHAIN", pl: "Retail chains 2026", scale: 1.4 },
  { code: "C011", name: "Uy Market Stores (demo)", type: "RETAIL_CHAIN", pl: "Retail chains 2026", scale: 1.1 },
  { code: "C012", name: "Dehqon Fresh Chain (demo)", type: "RETAIL_CHAIN", pl: "Retail chains 2026", scale: 0.9 },
  { code: "C013", name: "Vodiy Food Distribution (demo)", type: "DISTRIBUTOR", pl: "Distributors 2026", scale: 3.0 },
  { code: "C014", name: "Samarqand Foods Trading (demo)", type: "DISTRIBUTOR", pl: "Distributors 2026", scale: 2.6 },
  { code: "C015", name: "Buxoro Cold Distribution (demo)", type: "DISTRIBUTOR", pl: "Distributors 2026", scale: 2.0 },
  { code: "C016", name: "Xorazm Logistic Foods (demo)", type: "DISTRIBUTOR", pl: "Distributors 2026", scale: 1.6 },
  { code: "C017", name: "Farg'ona Sovuq Savdo (demo)", type: "DISTRIBUTOR", pl: "Distributors 2026", scale: 1.8 },
  { code: "C018", name: "Chorsu Wholesale Market (demo)", type: "WHOLESALE", pl: "Base wholesale", scale: 1.5 },
  { code: "C019", name: "Qo'yliq Ulgurji (demo)", type: "WHOLESALE", pl: "Base wholesale", scale: 1.2 },
  { code: "C020", name: "Toshkent Meat Trade (demo)", type: "WHOLESALE", pl: "Base wholesale", scale: 1.3 },
  { code: "C021", name: "Andijon Ulgurji Savdo (demo)", type: "WHOLESALE", pl: "Base wholesale", scale: 1.0 },
] as const;

export const PRICE_LIST_DISCOUNT: Record<string, number> = {
  "HoReCa contract 2026": 0.97,
  "Retail chains 2026": 0.93,
  "Distributors 2026": 0.9,
  "Base wholesale": 0.95,
};

export const CUSTOMER_BASKETS: Record<string, string[]> = {
  HORECA: ["CH-BRF", "CH-THF", "CH-WNG", "CH-WHOLE", "CH-DRU", "SF-SHA", "BP-LIV", "CH-INF", "RC-STK"],
  RETAIL_CHAIN: ["CH-WHOLE", "CH-BRF", "CH-THI", "CH-DRU", "CH-WNG", "CH-THF", "BP-LIV", "BP-HRT", "BP-GIZ", "CH-BCK", "RC-DRM", "RC-WBQ", "FR-WHOLE", "FR-BRF"],
  DISTRIBUTOR: ["CH-WHOLE", "FR-WHOLE", "CH-THI", "CH-DRU", "CH-BCK", "BP-NCK", "BP-FEET", "FR-THI", "FR-DRU", "FR-WNG", "FR-BCK", "CH-BRF"],
  WHOLESALE: ["CH-WHOLE", "CH-BCK", "BP-FEET", "BP-NCK", "BP-GIZ", "CH-THI", "CH-WNG", "CH-MNC"],
};

export const STORES = [
  { code: "S01", name: "SAFI Fresh #1 Chilonzor (demo)", region: "Tashkent", address: "Chilonzor district, Bunyodkor ave." },
  { code: "S02", name: "SAFI Fresh #2 Yunusobod (demo)", region: "Tashkent", address: "Yunusobod district, Amir Temur ave." },
  { code: "S03", name: "SAFI Fresh #3 Mirzo Ulugbek (demo)", region: "Tashkent", address: "Mirzo Ulugbek district, Buyuk Ipak Yo'li st." },
  { code: "S04", name: "SAFI Fresh #4 Sergeli (demo)", region: "Tashkent", address: "Sergeli district, Yangi Sergeli st." },
  { code: "S05", name: "SAFI Fresh #5 Yakkasaroy (demo)", region: "Tashkent", address: "Yakkasaroy district, Shota Rustaveli st." },
  { code: "S06", name: "SAFI Fresh #6 Olmazor (demo)", region: "Tashkent", address: "Olmazor district, Qorasaroy st." },
  { code: "S07", name: "SAFI Fresh #7 Chirchiq (demo)", region: "Tashkent region", address: "Chirchiq, Amir Temur st." },
  { code: "S08", name: "SAFI Fresh #8 Samarkand (demo)", region: "Samarkand", address: "Samarkand, Registon st." },
  { code: "S09", name: "SAFI Fresh #9 Bukhara (demo)", region: "Bukhara", address: "Bukhara, Mustaqillik st." },
  { code: "S10", name: "SAFI Fresh #10 Fergana (demo)", region: "Fergana", address: "Fergana, Al-Farg'oniy st." },
];

export const STORE_ASSORTMENT = ["CH-WHOLE", "CH-BRF", "CH-THI", "CH-DRU", "CH-WNG", "CH-INF", "BP-LIV", "BP-HRT", "BP-GIZ", "CH-MNC", "SF-SHA", "RC-DRM", "RC-WBQ", "RC-STK", "CH-BCK"];

export const VEHICLES = [
  { plate: "01 A 101 SA", model: "Isuzu NPR 75 reefer", type: "REFRIGERATED", cap: 4500, dev: "WLN-358201" },
  { plate: "01 A 102 SA", model: "Isuzu NPR 75 reefer", type: "REFRIGERATED", cap: 4500, dev: "WLN-358202" },
  { plate: "01 A 103 SA", model: "Isuzu NQR 90 reefer", type: "REFRIGERATED", cap: 6000, dev: "WLN-358203" },
  { plate: "01 A 104 SA", model: "Hyundai HD78 reefer", type: "REFRIGERATED", cap: 4000, dev: "WLN-358204" },
  { plate: "01 A 105 SA", model: "Hyundai HD78 reefer", type: "REFRIGERATED", cap: 4000, dev: null },
  { plate: "01 A 106 SA", model: "Labo reefer van", type: "VAN", cap: 600, dev: null },
  { plate: "01 A 201 SA", model: "Isuzu FVR freezer", type: "FREEZER", cap: 9000, dev: "WLN-358211" },
  { plate: "01 A 202 SA", model: "MAN TGL freezer", type: "FREEZER", cap: 8000, dev: null },
] as const;

export const ROUTES = [
  { code: "R-TSH-N", name: "Tashkent North (Yunusobod, Mirzo Ulugbek)", regions: ["Tashkent"], min: 240 },
  { code: "R-TSH-S", name: "Tashkent South (Chilonzor, Sergeli, Yakkasaroy)", regions: ["Tashkent"], min: 240 },
  { code: "R-TSHR", name: "Tashkent region (Chirchiq, Ohangaron)", regions: ["Tashkent region"], min: 300 },
  { code: "R-SAM", name: "Samarkand – Bukhara trunk", regions: ["Samarkand", "Bukhara"], min: 600 },
  { code: "R-VAL", name: "Fergana valley trunk", regions: ["Fergana", "Andijan", "Namangan"], min: 540 },
  { code: "R-STORES", name: "SAFI Fresh store replenishment", regions: ["Tashkent"], min: 180 },
];
