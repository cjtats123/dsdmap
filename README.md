# CEPALCO Accounts Mapping

A small GitHub + Netlify site with **one page: Accounts Mapping** (`dmap.html`). Everything else from the full monitoring system (Collections, Accounts grid, Contact Directory, reports, DN / Job Order, EMAIL/SMS generator) is not in this repo, and the server no longer has those actions.

## What people see
- **Sign in** (`login.html`), then the **Accounts Mapping** page: four tabs (Delinquent, Partially paid, Fully paid, Unbilled), filters, list, map, pins, KML/KMZ/CSV import and KML export. See `DELINQUENT-MAP.md`.
- **Admin** (`admin.html`, admin only): users, permissions, backups, sign-in log, change log.
- `index.html` only redirects to the map.

## Permissions (Admin page)
One row: **Accounts Mapping**. **View** opens the map and lists; **Edit** places, moves and removes pins and imports pins. Guests start with no access. Phone numbers are shown to everyone who can open the map. Every action is checked again on the server.

## Data
The admin clicks **Load Excel** on the Accounts Mapping page and picks the `ACCOUNTS_MASTERLIST` workbook (sheet `MONITORING FOR CODE`). It is read in the browser and saved to the site's private Netlify Blobs storage. The repo contains no customer data (`.gitignore` blocks `.xlsx`, `.xlsm`, `.csv`, `.zip`). Use a private repo.

Columns read: `CUSTOMER TYPE, BILLING, DN/ODAA, JOB-ORDER, CLN, SUB-AREA, CUSTOMER NAME, AREA, RATE SCHED, CONTRACT NO., MONTHS UNPAID, DUE DATE, PAYMENT DATE, REMAINING BALANCE, SMS, EMAIL, FIELD REMARKS, PHONE NO., EMAIL ADDRESS, Contact Person`.

Status tabs come from **REMAINING BALANCE** + **PAYMENT DATE**:
- Delinquent: balance left, no payment date.
- Partially paid: balance left and a payment date (or "partial" in DN/ODAA).
- Fully paid: no balance and a payment date (or PAID in DN/ODAA), or an overpayment.
- Unbilled: no balance and no payment date.

Pins are saved by contract number + customer name, so they survive a new Load Excel.

## Deploy (new Netlify site)
1. Create a **private** GitHub repository and push these files (the `.gitignore` already blocks spreadsheets, CSVs and zips).
2. Netlify: Add new site > Import from Git > pick the repo. Build command: leave empty. Publish directory: `.` (netlify.toml already sets this and the functions folder). Netlify installs `@netlify/blobs` by itself.
3. **Before the first visit**, in Site configuration > Environment variables add `ADMIN_PASSWORD` = a strong password (8+ characters). The first `admin` account is created with it. If you skip this, the first sign-in is `admin` / `admin` and the site forces a new password straight away, but anyone who finds the URL first could do that, so set it.
4. Deploy, sign in as `admin`, open Accounts Mapping and click **Load Excel**, then add users and tick their permissions on the Admin page.
5. To test Import pins, use `sample-pins.kml` (fake data; it will report 2 not matched unless contract numbers 100001 / 100002 exist).

Notes: users, data, pins, backups and logs live in the site's Netlify Blobs store, so a redeploy never erases them. Deploy to a new site = a new empty store (nothing carried over from the old site).

This is a separate Netlify site, so it has its own users and data (nothing is shared with the full monitoring site).
