# Tampermonkey Scripts

Scripts for working with SPOT CRM and filter supplier sites. All run via Tampermonkey.

## Auto-updates

Install `_script_updater.user.js` once — it keeps all other scripts up to date automatically.

- Checks the private GitHub repo once per day in the background
- Opens an install tab for each script that has a newer `@version`
- Manual trigger available via the Tampermonkey extension menu → **Проверить обновления скриптов сейчас**

---

## SPOT CRM — Liquid Glass v5

**Site:** `*/analyse/free*`

Full redesign of the stock availability page (`/analyse/free`). Replaces the default CRM layout with a custom shell.

**Features:**
- Sidebar navigation built from the existing CRM menu (preserves links and active states)
- Sticky topbar with page title and station badge
- Collapsible filter panel with station count display
- Table wrapped in a styled card with row count
- Animated particle canvas — dots drift and react to cursor movement
- Dark / light theme toggle, preference saved to `localStorage`
- Hidden scrollbars, custom input/button/select styles throughout
- Smooth row entrance animations

**Why:** The default CRM page is visually outdated and dense. This makes the analyse/free section easier to scan and use daily.

---

## SPOT: Поиск цен по артикулам

**Site:** `*/analyse/free*`

A floating panel that lets you paste any number of part numbers and find their prices in the CRM stock table.

**Features:**
- Accepts multiple SKUs (one per line, any quantity)
- Auto-detects filter type from product name (вф / мф / сф / тф) — no manual classification needed
- Groups results by SKU and filter type, sorts: air → oil → cabin → fuel
- Marks the cheapest option per group with a "best price" badge
- Pre-selects the best price checkbox in the selection modal
- Station dropdown mirrors the current CRM filter selection
- Copies selected results to clipboard in one click
- Panel collapses to a header, state saved in `sessionStorage`

**Why:** Manually searching through the table for each SKU one by one wastes time. This handles bulk lookup and price comparison in one pass.

---

## ZMS CRM — Продлить запись + Умное удаление

**Site:** `https://zamena-masla-spot.ru/admin/record*`

Two separate features injected into the record edit/list pages.

**Extend button** (edit/create pages):
- Adds an "⏱ Продлить" button next to Save
- Calls the CRM scheduling API to find consecutive free slots after the current one
- Shows a dropdown to pick how many 30-minute slots to add (up to end of day at 20:30)
- Saves the original record, then creates extension slots in sequence
- Extension slots use a placeholder phone number; no SMS is sent to the client

**Smart delete** (record list page):
- Intercepts delete actions on unusually long records (those with many slots)
- Shows a confirmation dialog before deletion to prevent accidental removal

**Why:** Extending a booking normally requires creating new records manually one by one. This does it in a single click with free-slot detection via the existing API.

---

## Копировать запись

**Site:** `*/admin/record/*`

Adds a copy button to the record edit form.

**Features:**
- Reads date, time, and station name from the form selects
- Copies a formatted string: `DD.MM.YYYY HH:MM Station Name (Сергей)`
- Button shows "✅ Скопировано!" for 2 seconds after copy

**Why:** Quick way to grab booking info for pasting into a chat or note without retyping.

---

## CRM — Карта метро СПб (записи по станциям)

**Site:** `*/admin/record*`

An interactive St. Petersburg metro map overlaid on the CRM record pages, showing bookings grouped by station.

**Features:**
- Full metro map built with HTML buttons (Lebedev Studio style)
- Station size slider
- Multiple bookings per time slot displayed on the same station
- Smart delete integration (ZMS Smart Delete)
- Working hours displayed as 09:00–21:00, last slot at 20:30

**Why:** The default CRM record list doesn't give a geographic view of where bookings are. The map makes it immediately obvious which stations are busy and which have capacity.

---

## Mann + Motul Oil Calculator

**Sites:** `mann-filter.com`, `lynxauto.info`, `motul.lubricantadvisor.com`, `rolfoil.ru`, `podbor.upec.pro`, `podbor.ravenol.ru`

A cross-site oil change calculator that tracks filter and oil selection across multiple supplier sites and produces a final service report.

**Features:**
- Runs on all relevant supplier sites, each with its own adapter (`initMann`, `initMotul`, `initRolf`)
- Maintains shared state across tabs via `GM_setValue` / `GM_getValue`
- Built-in oil database: Liqui Moly, ROLF, and others with viscosity, price, and approvals (API, ACEA, OEM specs)
- Matches car manufacturer requirements to available oils
- Generates a complete oil change report: filters selected (air / oil / cabin), oil chosen, total cost

**Why:** Selecting the right oil requires cross-referencing manufacturer approvals across multiple sites. This keeps everything in one flow without switching tabs manually.

---

## "Скопировать 3 артикула" — GoodWill / LYNXauto / MANN-FILTER

Three separate scripts for three supplier catalogs. Each does the same job adapted for the site's HTML structure.

**Sites:**
- `goodfil.com` — GoodWill catalog
- `lynxauto.info` — LYNXauto catalog
- `mann-filter.com/*/catalog*` — MANN-FILTER catalog

**Features:**
- Floating "📋 Скопировать 3 артикула" button fixed to bottom-right
- Scans visible product cards/rows and classifies each as air / oil / cabin filter
- Copies exactly three SKUs (one per type) to clipboard, newline-separated
- Per-card copy buttons added inline next to each SKU
- Alerts if any filter type is missing from the results
- MutationObserver keeps buttons alive after dynamic content loads (Vue/React pages)

**Type detection per site:**
- **GoodWill** — by SKU prefix pattern: `OG` = oil, `AG ... CF/CFC` = cabin, `AG ...` = air
- **LYNXauto** — by `span.list_showtable-name2` text content
- **MANN-FILTER** — by card title text; prioritizes `CU` over `CUK` for cabin; skips `FP` prefixed SKUs and outdated items (no start date in date range)

**Why:** When looking up filters for a car, you need all three types. Copying them one by one from the catalog is slow. These scripts grab all three in one click, ready to paste into the CRM or a spreadsheet.
