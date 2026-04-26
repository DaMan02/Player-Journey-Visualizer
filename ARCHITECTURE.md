# Architecture

## What I Built

I built a static web visualization tool backed by a Python preprocessing step. The browser app is plain HTML/CSS/JavaScript because the dataset is modest after compaction, the assignment needs a shareable hosted link, and a static site keeps deployment simple.

## Data Flow

| Stage | Responsibility |
| --- | --- |
| `player_data/February_*/*.nakama-0` | Raw parquet files, one player or bot journey per match. |
| `scripts/preprocess.py` | Reads parquet with `pyarrow`, decodes binary event names, identifies bots, projects world coordinates, groups rows by match and player, and writes compact JSON. |
| `public/data/telemetry.json` | Browser-ready payload containing map config, match index, player events, summary stats, and assumptions. |
| `index.html` + `src/app.js` | Renders minimap layers, filters by map/date/match, plays match time, draws event markers, and generates heatmaps in canvas. |

## Coordinate Mapping

The data uses world `x`, `y`, and `z`, but the minimap is a 2D top-down image, so the viewer uses only `x` and `z`. For each map, the README gives `scale`, `origin_x`, and `origin_z`. The preprocessing script applies the provided conversion:

```text
u = (x - origin_x) / scale
v = (z - origin_z) / scale
pixel_x = u * 1024
pixel_y = (1 - v) * 1024
```

The `1 - v` flip is required because image coordinates start at the top-left, while world Z increases in the opposite visual direction. The script also counts out-of-bounds projected rows; this dataset produced `0`.

## Assumptions

- Numeric `user_id` values are bots; UUID-shaped IDs are human players.
- Folder names provide the date filter because match playback uses relative time.
- Raw `ts` values behave like Unix seconds stored in a `timestamp[ms]` parquet column. Treating them literally makes full matches last less than one second, so deltas are converted from seconds to milliseconds.
- Multiple selected matches share one playback slider by normalizing each match to its own start time.

## Tradeoffs

| Decision | Why | Tradeoff |
| --- | --- | --- |
| Static frontend | Easy to host and review from one repo. | Large datasets would eventually need API pagination or tiled payloads. |
| Precompute pixel coordinates | Keeps browser rendering simple and makes coordinate math auditable. | If map configs change, the JSON must be regenerated. |
| Canvas rendering | Handles thousands of paths and heat points better than DOM/SVG. | More custom interaction code for hover tooltips. |
| Single JSON payload | Fast enough at about 3.5 MB and simple to deploy. | Initial load fetches all telemetry instead of lazy-loading by map. |

