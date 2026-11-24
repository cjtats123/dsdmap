# CEPALCO Map

A small GitHub + Netlify site with **one page: a map for every CEPALCO employee** (`dmap.html`). All places come from a **KML / KMZ file** uploaded by the administrator. There is no customer or billing data in it.

## What people see
- **Sign in** (`login.html`), then the **Map**: pins (one colour per KML folder / category), search, category filter, a list of places, and for each place its name, category, description, extra fields, a **Directions** link (Google Maps) and **Copy location**. Street or Satellite view. **Export KML** downloads what is shown.
- **Admin** (`admin.html`, admin only): users, permissions, backups, sign-in log, change log.
- `index.html` only redirects to the map.

## Putting places on the map
Sign in as admin (or any user with **Edit**), click **Upload KML**, choose one or **several** `.kml` / `.kmz` files at once (hold Ctrl/Shift, or select all in the folder) (Google Earth or Google My Maps export). Nothing has to be typed:
- Name = placemark name. Category = the KML folder it sits in (or the document name). Description and any extra data fields (My Maps columns) are shown in the pin's popup.
- Only point placemarks are shown. Lines and areas in the file are skipped (the upload tells you how many).
- You choose **Replace the map** (a backup is kept) or **Add to the map** (identical entries are skipped).
- Built for big maps: up to 250,000 places (a 71,000-place map from ten My Maps files was tested). Select all your files in one go: they are combined and saved as one upload (one backup, duplicates across files skipped). A file that cannot be read is reported and left out. A few thousand places take well under a minute. Users with Edit can also move or remove a single pin.
- On phones a map with tens of thousands of pins is slower to open; pick a category in the category list to show just that category.
- `sample-pins.kml` is a fake file for trying it out.

## Permissions (Admin page)
One row: **Map**. **View** opens the map. **Edit** uploads KML files and moves / removes pins. New users start with View. Guest starts with no access: tick View for Guest if employees should open the map with **Continue as guest** (no account). Every action is checked again on the server.

## Deploy (new Netlify site)
1. Create a GitHub repository and push these files. (The `.gitignore` blocks spreadsheets, CSVs and zips. Use a private repo if the KML has sensitive locations.)
2. Netlify: Add new site > Import from Git > pick the repo. Build command: leave empty. Publish directory: `.` (netlify.toml sets this and the functions folder; Netlify installs `@netlify/blobs` by itself).
3. **Before the first visit**, in Site configuration > Environment variables add `ADMIN_PASSWORD` = a strong password (8+ characters). The first `admin` account is created with it. If you skip this, the first sign-in is `admin` / `admin` and the site forces a new password straight away, but whoever opens the site first could take the admin account, so set it.
4. Deploy, sign in as `admin`, click **Upload KML**, then add users on the Admin page (or switch on Guest view).

Users, places, backups and logs live in the site's Netlify Blobs store, so a redeploy never erases them. A new site starts empty.

## Overdue balances (collection reports)
Sign in as admin (or a user with **Edit**), click **Upload balances**, and choose the collection report `.txt` files (one or several at once, e.g. AREA2 to AREA6). The reports overlap, so each account is counted once. Balances are matched to pins by **contract number** (leading zeros ignored; the pin's `CONTRACTNO` field or `CONTRACTNO:` line in its description). Pins then show the overdue amount, and the **balance filter** lists the biggest first. A summary shows how many accounts have no pin, with a CSV download. Each upload replaces the previous balances. Only admin and users with Edit can see or upload balances (`BAL_NEEDS_EDIT` in `api.js`).
