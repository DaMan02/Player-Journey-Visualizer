# Player Journey Visualizer

A static browser tool for exploring player journeys, combat events, loot pickups, storm deaths, and traffic heatmaps from the provided parquet telemetry.

## Hosted URL

Production URL: add the Vercel, Netlify, or GitHub Pages URL after publishing this repo.

Local preview URL: `http://localhost:8080`

## Tech Stack

- Static HTML/CSS/JavaScript for the viewer.
- Python + `pyarrow` for parquet preprocessing.
- No frontend build step or runtime server dependency.

## Setup

```bash
npm run setup
npm run preprocess
npm run serve
```

Then open `http://localhost:8080`.

## Data Flow

1. Raw parquet files live under `player_data/February_*`.
2. `scripts/preprocess.py` reads every `.nakama-0` parquet file, decodes byte events, detects bots from numeric user IDs, maps world coordinates to minimap pixels, and normalizes match playback time.
3. The script writes `public/data/telemetry.json` and copies minimaps into `public/minimaps/`.
4. `src/app.js` loads the generated JSON and renders paths, markers, filters, playback, and heatmaps.

## Deployment

This project is static once `public/data/telemetry.json` has been generated. Deploy the repo root as a static site.

- Build command: `npm run setup && npm run preprocess`
- Publish directory: `.`
- Environment variables: none

## Notes

- The source file is named `instuctions.txt` in this workspace.
- The raw parquet `ts` values behave like Unix seconds stored in a `timestamp[ms]` column. The preprocessing script converts deltas to milliseconds for browser playback.
- Folder names are used for calendar date filters because playback time is normalized per match.
