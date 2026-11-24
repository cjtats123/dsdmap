# Map page notes (`dmap.html`)

- Permission key is still `dmap` (label "Map"). View = see the map. Update (Edit) = upload KML, move, remove.
- Server actions in `netlify/functions/api.js`: `map_get` (everyone with View; returns a few MB of places per call with a `next` pointer, the page loops until done), `map_put` (upload, in chunks of 500, `mode` replace / add), `map_move`, `map_del`.
- Storage (Netlify Blobs): `pidx` = index of shards, `ps-<key>` = up to 1000 places each, `pkeys` = short hashes used to skip duplicates. A backup only remembers which shard files made up the map; unused shard files are cleaned up automatically.
- KML reading is in the browser (`kml()` in dmap.html): Placemark > Point only; category = enclosing Folder names joined with " / " (else the Document name); description HTML is turned into plain text; `Data` / `SimpleData` become extra fields (max 15, 200 characters each).
- Pin colour = category (12 colours, most used categories first). Clusters are red with the count.
- Limits: 250,000 places, name 200, category 80, description 1500 characters.
- Backups (4 kept) are made before every upload and restore; restore them on the Admin page. Every upload, move and removal is in the Admin change log.
