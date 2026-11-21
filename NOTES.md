# PALMIRA HEAT — build notes (gta6-01)

Original open-world crime game: top-down 2.5D, canvas 2D, no libraries, all code ours.
City "Palmira", driver Rico Vega, five-mission story chain + free-roam systems.

## Stage log
- [x] S0 Recon: RULES.txt + briefs U1–U6/J8 read. Gate facts pinned:
      game/ <=993 files, <=48 MiB, index.html <=1 MiB, relative imports only;
      screenshots 3–4, <=256 KiB each, long <=1280, short >=480;
      dossier via unchanged vendor/makefun-game.ts; judge = screenshots + outline.
- [x] S0 Play-test rig: /tmp/drive.mjs (raw CDP over Node WebSocket) drives
      /opt/meta-chromium/chrome with the hatch WebGL allow-all policy
      (/tmp/webgl-policy.txt, sha256 8097045f...64c6). Smoke test passed.
- [x] S1 main.ts rewritten in our own words (same caps/behaviour) + NOTES.md.
- [x] S2 Engine core: index.html, config, random, input, city, render, main —
      player on foot + enter/drive cars, camera, collisions.
- [x] S3 Traffic AI, pedestrians, police + wanted, combat, busted/wasted.
- [x] S4 HUD + minimap, missions/story, save, title screen, audio.
      Play-test (CDP driver, real input): title → new game → mission auto-start →
      walk → enter truck → drive 207 px/s → pause → heat 135 → 5 stars, 5 units,
      chase — zero console/page errors. Fixes along the way: canvas backing store
      pinned to 1280×720, favicon data URI, cars clamped off the water.
- [ ] S5 Shot staging (?shot=cover|foot|mission|dusk), 4 screenshots, polish
      (incl. one genuine revision edit to main.ts for thinking_revised).
- [ ] S6 main.ts x2 byte-identical, kit check, final commit + report.

## For the coordinator
- .makefun/owner.json not added (repo owner = account login serauis); add only if needed.
- serve.ts / shots.json are kit starter plumbing; shots.json updated to our scenes at S5.
- vendor/makefun-game.ts untouched (sha must stay the kit's).
