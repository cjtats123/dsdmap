# Map page notes (`dmap.html`)

- Permission key is still `dmap` (label "Map"). View = see the map. Update (Edit) = upload KML, move, remove.
- Server actions in `netlify/functions/api.js`: `map_get` (everyone with View), `map_put` (upload, in chunks of 300, `mode` replace / add), `map_move`, `map_del`. Data is one Blobs entry `places`: `{n: file name, at, r: [{id, n, c, d, f, la, ln}]}`.
- KML reading is in the browser (`kml()` in dmap.html): Placemark > Point only; category = enclosing Folder names joined with " / " (else the Document name); description HTML is turned into plain text; `Data` / `SimpleData` become extra fields (max 15, 200 characters each).
- Pin colour = category (12 colours, most used categories first). Clusters are red with the count.
- Limits: 30,000 places, name 200, category 80, description 1500 characters.
- Backups (8 kept) are made before every upload and restore; restore them on the Admin page. Every upload, move and removal is in the Admin change log.
