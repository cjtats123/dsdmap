# CEPALCO Map

A small GitHub + Netlify site with **one page: a map for every CEPALCO employee** (`dmap.html`). All places come from a **KML / KMZ file** uploaded by the administrator. There is no customer or billing data in it.

## What people see
- **Sign in** (`login.html`), then the **Map**: pins (one colour per KML folder / category), search, category filter, a list of places, and for each place its name, category, description, extra fields, a **Directions** link (Google Maps) and **Copy location**. Street or Satellite view. **Export KML** downloads what is shown.
- **Admin** (`admin.html`, admin only): users, permissions, backups, sign-in log, change log.
- `index.html` only redirects to the map.

## Putting places on the map
Sign in as admin (or any user with **Edit**), click **Upload KML**, choose the `.kml` or `.kmz` (Google Earth or Google My Maps export). Nothing has to be typed:
- Name = placemark name. Category = the KML folder it sits in (or the document name). Description and any extra data fields (My Maps columns) are shown in the pin's popup.
- Only point placemarks are shown. Lines and areas in the file are skipped (the upload tells you how many).
- You choose **Replace the map** (a backup is kept) or **Add to the map** (identical entries are skipped).
- Built for big maps: up to 250,000 places (a 71,000-place map from ten My Maps files was tested). Upload the files **one at a time** and choose **Add to the map** for each after the first; a file with a few thousand places takes well under a minute. Users with Edit can also move or remove a single pin.
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
