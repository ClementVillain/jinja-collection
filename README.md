# ⛩ Jinja Collection

**A map of 30,000+ Shinto shrines in Japan. Check off the ones you visit, collect a unique postcard for each, and share your visits with friends.**

**Live:** [jinja-collection.vercel.app](https://jinja-collection.vercel.app) · Web app + iOS / Android app (React Native / Expo)

---

## Highlights

- **30,445 shrines** across all 47 prefectures, built from OpenStreetMap data with a custom fetch script.
- **One codebase, three runtimes**: shared logic (sync, geo, routing, postcards) runs in the browser, in Node serverless functions and in the React Native app.
- **Turn-by-turn navigation**: live position, next manoeuvre (OSRM routing), arrival time, automatic rerouting, and a simulation mode for testing.
- **Google sign-in with conflict-free sync**: visits and notes merge across devices; the most recent action per shrine wins.
- **Friends**: requests, friends' visits shown on the map, shared collections.
- **Generated postcards**: one per shrine, with season, landscape and rarity (common, rare ★, legendary ★★), downloadable as PNG.
- **Community photos** with privacy built in: resized to 1600 px, GPS metadata stripped, moderation script.
- **Tested** with Node's built-in test runner (sync, navigation, friends, geo).

---

## Features

- **Map**: unvisited shrines grouped in clusters, visited shrines always shown as red torii.
- **Explore**: search by Japanese or romanised name (`伏見稲荷`, `meiji jingu`…).
- **Visited**: chronological list with visit notes.
- **Collection**: your postcards, one per visited shrine.
- **Cover photos**: Google Maps photo when configured, otherwise Wikimedia (via OpenStreetMap/Wikidata), a community photo, or the postcard illustration.
- **Navigation**: "Go there" from a shrine, or "Start" on a planned route. Add `?simulate=1` to the URL to test without moving (`&vitesse=10` to speed up).
- **Offline-friendly**: without an account, visits stay in the browser (localStorage) and can be exported as JSON.

The interface is in French.

---

## Tech stack

| Area | Technology |
|---|---|
| Web | Vanilla JavaScript, Leaflet-style map with clustering, no bundler |
| Mobile | React Native + Expo (iOS, Android via EAS Build) |
| Backend | Vercel serverless functions (Node) |
| Storage | Vercel Blob (user sync data, community photos) |
| Auth | Google Identity Services (token signature verified server-side) |
| Data | OpenStreetMap (`amenity=place_of_worship` + `religion=shinto`), Wikidata, Wikimedia |
| Routing | OSRM |
| Tests | `node --test` |

---

## Repository layout

```
apps/
  web/        Website (public/) and Vercel serverless functions (api/, lib/)
  mobile/     React Native / Expo app — see apps/mobile/README.md
packages/
  shared/     Code and data shared by the site, the server and the app:
              data/shrines.json, merge.js, proximity.js, route.js, geo.js, card.js,
              plus the scripts that regenerate the data
docs/         Working rules (git flow, versioning)
```

The site has no bundler: `apps/web/scripts/build.mjs` copies `packages/shared` into `apps/web/public/shared/` and `public/data/` (git-ignored). Vercel runs it on every deploy and only publishes `apps/web/public/`. Serverless functions import the shared files by relative path; the app imports them through `@jinja/shared`.

---

## Getting started

```bash
npm install            # at the root, once
npm run dev -w apps/web
```

Open http://localhost:8642. After changing `packages/shared`, restart `npm run dev`.

### Tests

```bash
npm test   # from the root: packages/shared, then apps/web
```

The mobile app keeps its own dependencies (`npm install` in `apps/mobile`) so it does not interfere with the iOS build.

### Updating the shrine data

Shrines come from OpenStreetMap rather than Google Maps: the Google Places API caps each search at 60 results, is paid, and forbids storing the data.

```bash
node packages/shared/scripts/fetch-shrines.mjs
```

---

## Configuration

### Google Maps photos (optional)

`apps/web/api/photo.js` calls the Google Places API (New) server-side, so the key never reaches the browser.

1. In Google Cloud Console, enable **Places API (New)** and create a key restricted to that API.
2. Set a **daily quota** to cap the bill (each opened popup costs one search + one photo).
3. Add the key to Vercel and redeploy:

```bash
vercel env add GOOGLE_MAPS_API_KEY production
vercel deploy --prod
```

Locally, `npm run dev` does not run `/api`, so the app falls back to Wikimedia. Use `vercel env pull` then `vercel dev` to test Google photos.

### Google sign-in and sync

- The browser gets an identity token from Google Identity Services; `apps/web/lib/auth.js` verifies its signature and audience.
- `apps/web/api/sync.js` reads and writes each account's `{ visits, deleted }` state in Vercel Blob under `users/<sha256(Google id)>/` (last 3 versions kept).
- `packages/shared/merge.js` merges browser and account state: for each shrine, the most recent action wins.

Create an OAuth client ID ("Web application") in Google Cloud Console, then:

```bash
vercel env add GOOGLE_CLIENT_ID production
vercel deploy --prod
```

Without `GOOGLE_CLIENT_ID`, the sign-in panel is hidden and the app works locally only.

### Community photos

Stored in Vercel Blob (store `jinja-photos`, Tokyo region) under `community/<shrineId>/`. `apps/web/api/upload.js` accepts uploads (JPEG, 3 MB max); `apps/web/api/community.js` lists the latest photo per shrine.

Moderation, from the repository root:

```bash
vercel env pull
node apps/web/scripts/remove-photo.mjs w561378888            # all photos of a shrine
node apps/web/scripts/remove-photo.mjs https://…/photo.jpg   # a single photo
```

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
