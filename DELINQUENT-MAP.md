# Accounts Mapping (`dmap.html`)

Nav tab **Accounts Mapping** (permission key still `dmap`, so existing access is kept). Shows accounts as pins on a map (Street or Satellite).

## Reading the map
- Pin colour = months unpaid: amber 1, orange 2, red 3+, grey not stated. Bigger pin = bigger balance.
- Filters: search, Area, Customer type, Months unpaid, Pinned / Not pinned. Counters above the map follow the filters.
- Click a dot (or an account in the list) for name, contract, area, months unpaid, balance, due date, DN/JO status and a **Directions** link (Google Maps). Phone shows for everyone who may open the map.
- **Export KML** downloads the pins currently shown (no phone numbers) for Google Earth / My Maps.

## Tabs (replaces the payment status filter)
Four tabs above the filters, each with a count (counts follow the other filters):
- **Delinquent**: balance left, no payment date. Pins coloured by months unpaid.
- **Partially paid**: balance left and a payment date (or "partial" in DN/ODAA). Yellow pin with a small checklist.
- **Fully paid**: nothing left and a payment date (or PAID in DN/ODAA). Orange pin with a check mark.
- **Unbilled**: no balance and no payment date. Blue pin with a dash.
The map, list, counters and KML export show the selected tab only. Months unpaid filter applies to Delinquent / Partially paid only.
- Server: `dmap_get` returns every account with `s` (0 delinquent, 1 partial, 2 fully paid, 3 unbilled), `pd`, and `v: 2`. If the page shows "server part is an old version", redeploy the site so `netlify/functions/api.js` is current.

## Sorting (list on the right)
Sort dropdown + arrow button (Asc / Desc): **Months unpaid** (default, high first), **Customer name**, **Balance**, **DN status**, **JO status**. Sorting only reorders the list; the pins on the map do not change.
- DN order (Asc): no DN, then GEN (generated), then OK (delivered). Same GEN/OK day = earlier day first.
- JO order (Asc): no JO, GEN, TENDER, OK (disconnected). Desc reverses it.
- Ties fall back to months unpaid, then balance, then name. Each list row now shows its DN and JO status chips.

## Speed notes
- Pins are grouped into clusters (Leaflet.markercluster, loaded from cdnjs); the cluster colour is the worst months-unpaid inside it. Zoom in or click a cluster to open it; pins on the exact same spot fan out at max zoom.
- Pin icons are cloned from a few shared templates; no CSS filters on pins.
- Filtering only adds / removes the pins that changed; big batches are added in small slices so the page does not freeze.
- Account data is requested while the map libraries load; the list loads more rows as you scroll; off-screen rows are not painted.
- Phones / tablets: no fade or marker zoom animation, smaller tile buffer, tiles load after the move ends. Map height follows the visible screen (dvh).
- If the cluster library cannot load, the map still works without clustering.

## Getting accounts onto the map
Accounts have no coordinates in the masterlist, so each one needs a pin once.
1. **One by one:** click **Place pin** on an account in the list, then click the map, or paste `8.4772, 124.6460` / a Google Maps link and press Set pin. Popup: **Move pin**, **Remove**.
2. **Many at once:** **Import pins** accepts `.kml`, `.kmz` (Google Earth or My Maps export), `.csv` or `.xlsx` (columns `CONTRACT NO.` and/or `CUSTOMER NAME` plus `LAT` and `LNG`, or one `COORDINATES` column "lat, lng"). The file picker shows all files (phones hide `.kml` when the picker is filtered).
   - KML: only point placemarks are read (lines and areas are skipped). The contract number is taken from a `CONTRACT NO.` / `Account` field in the placemark's data (My Maps), or from "Contract No: 123456" in the name or description, or a long number in the name (`123456 - JUAN DELA CRUZ`). If none matches, the placemark name must equal one customer name exactly.
   - The result message says how many were saved and lists the ones that were not matched.
   - `sample-pins.kml` is a fake two-pin file for testing the button.

Pins are saved by **contract number + customer name**, not by row, so they stay after **Load Excel**. Pins for paid accounts are kept and show again if the account becomes delinquent.

## Permissions (Admin page, new row "Accounts Mapping")
- **View:** see the map and list. **Update:** place, move, remove and import pins. Create/Delete do not apply.
- Existing users and Guest start with no access; tick it in Admin.
- Checked again on the server (`dmap_get`, `dmap_set`). Pin changes appear in the Admin change log (map pin set / removed / import).

## Files changed (original build)
`dmap.html` (new; later rewritten for speed + sorting, no server change needed), `netlify/functions/api.js` and `api.js` (same patch in both), `auth.js`, nav link in `index.html`, `dnjo.html`, `smsgen.html`, `report.html`, `admin.html`.

## Tested
Server actions (login, forced password change, permissions, Load Excel, pin import by contract / alternate number / name) ran against an in-memory store, and the KML reader ran in Chromium on Google Earth, My Maps, description-style and "number - name" files. The full page was not opened with live map tiles: after deploying, try Place pin, Import pins and Export KML once.
