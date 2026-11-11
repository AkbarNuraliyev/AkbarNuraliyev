# Role tutorial videos

Short Russian-language video guides for every PoultryOS role (owner, company admin, department
manager, warehouse employee, driver, B2B customer, platform super admin). They are recorded from
the real application: every screen and every result shown in a video was produced by actually
using the app (accepting a delivery, starting a trip, placing a portal order), on a copy of the demo database.

## Pipeline

| Step | Script | Output |
|---|---|---|
| 1. Storyboards — steps, highlighted element, caption, narration | `scripts/video/storyboards.mjs` | — |
| 2. Copy the demo DB and prepare a planned shipment for the driver | `scripts/video/prep-video-db.ts` | `poultryos_video` database |
| 3. Capture screenshots + element positions (Playwright, ru-RU) | `scripts/video/capture.mjs` | `<cap>/<role>/NN.png`, `manifest.json`, `english-strings.json` |
| 4. Narration (offline, RHVoice voice “Elena”) | `scripts/video/voice.mjs` | `<voice>/<role>/*.wav`, `voice.json` |
| 5. Assemble data for Remotion | `scripts/video/build-data.mjs` | `video/src/data.json`, `video/public/{cap,voice}` |
| 6. Render (Remotion, 1920×1080, 30 fps) | `npx remotion render role-<key>` | `video/out/<key>.mp4` |

```bash
# 2. database copy (never record against the main demo DB — steps perform real actions)
sudo -u postgres createdb -O poultryos poultryos_video
sudo -u postgres sh -c "pg_dump poultryos | psql -q poultryos_video"
DATABASE_URL="postgresql://poultryos:poultryos@localhost:5432/poultryos_video" npx tsx scripts/video/prep-video-db.ts
DATABASE_URL="postgresql://poultryos:poultryos@localhost:5432/poultryos_video" npx next start -p 3200

# 3–5
BASE_URL=http://localhost:3200 node scripts/video/capture.mjs /tmp/cap
sudo apt-get install -y rhvoice rhvoice-russian
node scripts/video/voice.mjs /tmp/voice
node scripts/video/build-data.mjs /tmp/cap /tmp/voice video

# 6
cd video && npm install
npx remotion studio                     # preview
npx remotion render role-01-owner out/01-owner.mp4
```

`capture.mjs` lists any untranslated English interface text it saw on screen in
`english-strings.json` — add those to `scripts/i18n_core.tsv` before the final capture.
Re-run step 2 before every capture: the driver and customer steps change the copied database.

Remotion is free for individuals and companies with up to 3 employees; larger companies need a
Remotion company licence (remotion.pro/license) to render these videos.
