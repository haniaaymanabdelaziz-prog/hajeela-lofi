# Website content

Every word, list and photo on the website comes from the content block at the top of `index.html`
(`<script id="hj-content">`). `content.json` is a readable copy of the same thing.
Edit content in the admin portal (Content). To put a change live, the portal's "Export content file"
replaces that block; Claude commits it on a branch for Hania to approve.

How this file was built from the hand-written site (only needed again if the layout code changes):
1. `node tools/extract-content.js index.html step1.html step1.json report.json` (needs `typescript`)
2. `node tools/link-content.js step1.html step1.json index.html content.json`

Content rules
- Trips: each departure has a real `date` (YYYY-MM-DD) and `time`. The label ("Thu 10 Dec"), the months a trip
  shows under and whether it is past are worked out on the page. Past dates drop off by themselves.
- Each trip has its own day plan in `TPLAN` (one line, highlights, days, what you'll learn, add-ons, what to buy,
  stay, pocket money). `_copy` names the trip the text was written for, when it was copied from another trip.
- Destinations carry their photo (`img.src`, `img.pos`).
