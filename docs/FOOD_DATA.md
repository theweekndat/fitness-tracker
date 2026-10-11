# Food data: Australian fast food and generic takeaway

Added 11 Oct 2026 at the user's request: "the food tracker has access to all Australian fast food joints and
generic takeout meals". This extends brief §4.4 and needs the user's approval where marked.

## The constraint

No free API covers Australian chain menus:
- **Open Food Facts** is barcode-centric; restaurant items are sparse and unverified.
- **FatSecret Platform**: the free Basic tier is US data only. Australian datasets appear to need the paid
  Premier tier. **Ruled out by the zero-spend rule.**
- Nutritionix and Edamam are paid and US-focused. Ruled out.

So "every joint" cannot be promised at zero cost. The design below covers the big national chains exactly, covers
generic takeaway from government data, and gives every other shop a fast, honest estimate.

## Layer 1: chain menu packs (exact, per item)

- One versioned JSON pack per chain (`data/chains/<chain>.json`), built from **the chain's own published nutrition
  information** (most large chains publish full guides with energy, protein, fat, saturated fat, carbs, sugars and
  sodium per item).
- Every item carries `source_url`, `as_of` date and per-serve values. Energy is stored in **kJ as published**
  (Australian guides are kJ-first) and converted to kcal at the edge (÷ 4.184), so the kJ/kcal trap cannot bite.
- Starting list (national chains, to confirm with the user): McDonald's, Hungry Jack's, KFC, Subway, Domino's,
  Pizza Hut, Red Rooster, Oporto, Nando's, Guzman y Gomez, Zambrero, Grill'd, Schnitz, Taco Bell, Carl's Jr,
  Chicken Treat, Mad Mex, Roll'd, Sushi Hub, Muffin Break, Gloria Jean's, Boost Juice, Starbucks, Krispy Kreme,
  Betty's Burgers, Lord of the Fries, El Jannah, Noodle Box. Brisbane-local favourites are added on request.
- **Licensing:** chains publish this data for consumers; copying it into a personal tool for personal use is low
  risk, but redistributing it is not ours to license. So: keep the repo **private**, attribute every item, and
  never publish packs.
- **Staleness:** menus change. The app shows "as of" on every chain item, and a pack older than 6 months gets a
  "check for updates" flag. Refreshing a pack is a manual, reviewed data update, never a scraper running in the
  Worker (CPU limit and terms of use).
- **Data quality:** every item goes through the same 4P + 4C + 9F check as Open Food Facts foods (flag >15%).

## Layer 2: generic takeaway (government data, free)

- **Australian Food Composition Database (AFCD, FSANZ)**: free Excel downloads, Creative Commons Attribution
  (2.5 AU on the data.gov.au listing for Release 1; **verify** the licence for the current Release 3).
  Generic Australian foods with full nutrient profiles.
- **AUSNUT 2011-13 (FSANZ)**: built for the national nutrition survey, so it includes mixed and takeaway dishes
  (e.g. hamburgers, pizza, fried rice, kebabs, fish and chips, curries). **Verify** coverage and licence.
- Imported once at build time into a compact JSON shipped with the app (and cached in IndexedDB), searchable
  offline. Attribution to FSANZ on the info sheet of every item.
- On top of the raw data, a curated **"Takeaway" list** (~150 common dishes such as "Chicken kebab, large",
  "Pad thai", "Butter chicken with rice", "Sushi roll, salmon avocado", "Fish and chips, 1 fillet + small chips",
  "Bánh mì, pork") with typical portion sizes in grams and small/medium/large options. Portion weights come from
  the FSANZ measures data where it exists, otherwise from weighing a real serve. Portions are estimates, labelled
  as such, with an uncertainty range on the number.

## Layer 3: any other shop (kJ from the menu board)

- QLD (Fast Choices, Food Act 2006), NSW and several other states require chains of 20+ outlets in the state
  or 50+ nationally to show **kilojoules on menus, menu boards, online ordering and apps**.
- "Quick-add from menu": type the kJ shown, pick the closest generic dish, and the app splits macros by that
  dish's ratios. Marked "estimated", with the source shown.
- Small independents with no kJ on the menu use the Layer 2 generic dish with a portion slider.
- Anything logged this way can be saved as a custom food so it is a one-time cost.

## Search and logging

- One search box over: recent and frequent foods → chain packs → takeaway list → AFCD/AUSNUT → Open Food Facts.
- Results show the source badge (chain name + as-of date, FSANZ, OFF, Custom) and per-serve kcal and protein.
- A "Restaurants" browse view: pick a chain, then its menu by category.
- Every log row snapshots the nutrients (brief §6), so pack updates never rewrite history.

## Phasing

- **Phase 0 (now):** confirm AFCD and AUSNUT licences and takeaway coverage, and confirm the chain list with
  the user. Blocked in this build environment: `foodstandards.gov.au` and the chain sites are not on the network
  allowlist.
- **Phase 1:** AFCD/AUSNUT import, the takeaway list, the menu-kJ quick-add, and the first 5 chain packs.
- **Phase 5:** the remaining chain packs, the staleness flags and the Restaurants browse view.

## Sources

- AFCD downloads: https://www.foodstandards.gov.au/science-data/food-nutrient-databases/afcd/australian-food-composition-database-download-excel-files
- AFCD licence listing: https://data.gov.au/data/dataset/a9159b56-487e-4897-ac45-ab62f7e8d232
- FatSecret editions: https://platform.fatsecret.com/api-editions
- QLD kilojoule menu labelling: https://www.qld.gov.au/health/staying-healthy/food-pantry/food-labelling/kilojoule-menu-labelling
