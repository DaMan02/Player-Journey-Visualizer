#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import shutil
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq


MAPS = {
    "AmbroseValley": {
        "label": "Ambrose Valley",
        "scale": 900,
        "originX": -370,
        "originZ": -473,
        "image": "public/minimaps/AmbroseValley_Minimap.png",
        "sourceImage": "AmbroseValley_Minimap.png",
    },
    "GrandRift": {
        "label": "Grand Rift",
        "scale": 581,
        "originX": -290,
        "originZ": -290,
        "image": "public/minimaps/GrandRift_Minimap.png",
        "sourceImage": "GrandRift_Minimap.png",
    },
    "Lockdown": {
        "label": "Lockdown",
        "scale": 1000,
        "originX": -500,
        "originZ": -500,
        "image": "public/minimaps/Lockdown_Minimap.jpg",
        "sourceImage": "Lockdown_Minimap.jpg",
    },
}

EVENT_TYPES = [
    "Position",
    "BotPosition",
    "Kill",
    "Killed",
    "BotKill",
    "BotKilled",
    "KilledByStorm",
    "Loot",
]
EVENT_INDEX = {name: index for index, name in enumerate(EVENT_TYPES)}
UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def decode_event(value: Any) -> str:
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf-8")
    return str(value)


def folder_to_date(folder_name: str) -> str:
    parsed = datetime.strptime(f"{folder_name}_2026", "%B_%d_%Y")
    return parsed.date().isoformat()


def is_bot(user_id: str) -> bool:
    return user_id.isdigit()


def map_to_pixel(map_id: str, x: float, z: float) -> tuple[float, float, float, float]:
    config = MAPS[map_id]
    u = (x - config["originX"]) / config["scale"]
    v = (z - config["originZ"]) / config["scale"]
    px = u * 1024
    py = (1 - v) * 1024
    return px, py, u, v


def compact_counts(counter: Counter[str]) -> dict[str, int]:
    return {event: int(counter[event]) for event in EVENT_TYPES if counter[event]}


def pct(part: int, whole: int) -> float:
    if whole == 0:
        return 0.0
    return round((part / whole) * 100, 1)


def ensure_minimaps(data_root: Path, out_root: Path) -> None:
    minimap_out = out_root / "public" / "minimaps"
    minimap_out.mkdir(parents=True, exist_ok=True)
    for map_config in MAPS.values():
        src = data_root / "minimaps" / map_config["sourceImage"]
        dst = minimap_out / map_config["sourceImage"]
        if src.exists():
            shutil.copyfile(src, dst)


def load_rows(data_root: Path) -> dict[str, Any]:
    matches: dict[str, Any] = {}
    map_stats: dict[str, Counter[str]] = defaultdict(Counter)
    global_events: Counter[str] = Counter()
    unique_humans: set[str] = set()
    unique_bots: set[str] = set()
    dates: set[str] = set()
    loaded_files = 0
    skipped_files = 0
    row_count = 0
    out_of_bounds_rows = 0

    file_paths = sorted(data_root.glob("*/*.nakama-0"))

    for path in file_paths:
        try:
            source_date = folder_to_date(path.parent.name)
        except ValueError:
            skipped_files += 1
            continue

        try:
            table = pq.read_table(
                path,
                columns=["user_id", "match_id", "map_id", "x", "z", "ts", "event"],
            )
        except Exception as exc:
            print(f"Skipping {path}: {exc}")
            skipped_files += 1
            continue

        if table.num_rows == 0:
            skipped_files += 1
            continue

        loaded_files += 1
        dates.add(source_date)

        user_ids = table["user_id"].to_pylist()
        match_ids = table["match_id"].to_pylist()
        map_ids = table["map_id"].to_pylist()
        xs = table["x"].to_pylist()
        zs = table["z"].to_pylist()
        # The parquet column is typed as timestamp[ms], but the stored integer values
        # line up with Unix seconds for Feb 2026. Treat deltas as seconds and convert
        # to milliseconds for browser playback.
        timestamps = [int(value) * 1000 for value in table["ts"].cast(pa.int64()).to_pylist()]
        events = [decode_event(value) for value in table["event"].to_pylist()]

        file_user = str(user_ids[0])
        kind = "bot" if is_bot(file_user) else "human"
        if kind == "bot":
            unique_bots.add(file_user)
        else:
            unique_humans.add(file_user)

        for index, event_name in enumerate(events):
            user_id = str(user_ids[index])
            match_id = str(match_ids[index])
            map_id = str(map_ids[index])
            x = float(xs[index])
            z = float(zs[index])
            ts = int(timestamps[index])

            if map_id not in MAPS:
                continue

            px, py, u, v = map_to_pixel(map_id, x, z)
            if not (0 <= u <= 1 and 0 <= v <= 1):
                out_of_bounds_rows += 1

            row_count += 1
            global_events[event_name] += 1
            map_stats[map_id]["rows"] += 1
            map_stats[map_id][event_name] += 1

            match = matches.setdefault(
                match_id,
                {
                    "id": match_id,
                    "date": source_date,
                    "mapId": map_id,
                    "players": {},
                    "eventCounts": Counter(),
                    "rows": 0,
                    "files": set(),
                    "_minTs": ts,
                    "_maxTs": ts,
                },
            )
            match["date"] = min(match["date"], source_date)
            match["mapId"] = map_id
            match["rows"] += 1
            match["files"].add(str(path))
            match["eventCounts"][event_name] += 1
            match["_minTs"] = min(match["_minTs"], ts)
            match["_maxTs"] = max(match["_maxTs"], ts)

            player = match["players"].setdefault(
                user_id,
                {
                    "id": user_id,
                    "kind": "bot" if is_bot(user_id) else "human",
                    "eventCounts": Counter(),
                    "events": [],
                    "_minTs": ts,
                    "_maxTs": ts,
                },
            )
            player["eventCounts"][event_name] += 1
            player["_minTs"] = min(player["_minTs"], ts)
            player["_maxTs"] = max(player["_maxTs"], ts)
            player["events"].append(
                [
                    ts,
                    round(px, 1),
                    round(py, 1),
                    EVENT_INDEX.get(event_name, len(EVENT_TYPES)),
                    round(x, 2),
                    round(z, 2),
                ]
            )

    match_index = []
    players_by_match = {}

    for match_id, match in matches.items():
        start_ts = match["_minTs"]
        end_ts = match["_maxTs"]
        players = []
        human_count = 0
        bot_count = 0

        for player in match["players"].values():
            if player["kind"] == "bot":
                bot_count += 1
            else:
                human_count += 1

            player["events"].sort(key=lambda row: row[0])
            for event_row in player["events"]:
                event_row[0] = int(event_row[0] - start_ts)

            player["startMs"] = int(player["_minTs"] - start_ts)
            player["endMs"] = int(player["_maxTs"] - start_ts)
            player["eventCounts"] = compact_counts(player["eventCounts"])
            del player["_minTs"]
            del player["_maxTs"]
            players.append(player)

        players.sort(key=lambda item: (item["kind"], item["id"]))
        players_by_match[match_id] = players

        match_index.append(
            {
                "id": match_id,
                "shortId": match_id.replace(".nakama-0", "")[:8],
                "date": match["date"],
                "mapId": match["mapId"],
                "durationMs": int(end_ts - start_ts),
                "playerCount": len(players),
                "humanCount": human_count,
                "botCount": bot_count,
                "rowCount": int(match["rows"]),
                "fileCount": len(match["files"]),
                "eventCounts": compact_counts(match["eventCounts"]),
            }
        )

    match_index.sort(key=lambda item: (item["date"], item["mapId"], item["shortId"]))

    serialized_map_stats = {}
    for map_id, stats in map_stats.items():
        rows = int(stats["rows"])
        serialized_map_stats[map_id] = {
            "rowCount": rows,
            "eventCounts": compact_counts(stats),
            "trafficSharePct": pct(rows, row_count),
        }

    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
        "eventTypes": EVENT_TYPES,
        "eventFields": ["t", "px", "py", "eventIndex", "x", "z"],
        "maps": {key: {k: v for k, v in value.items() if k != "sourceImage"} for key, value in MAPS.items()},
        "dates": sorted(dates),
        "matchIndex": match_index,
        "playersByMatch": players_by_match,
        "summary": {
            "sourceFiles": len(file_paths),
            "loadedFiles": loaded_files,
            "skippedFiles": skipped_files,
            "rowCount": row_count,
            "matchCount": len(matches),
            "uniqueHumans": len(unique_humans),
            "uniqueBotIds": len(unique_bots),
            "outOfBoundsRows": out_of_bounds_rows,
            "eventCounts": compact_counts(global_events),
            "maps": serialized_map_stats,
        },
        "assumptions": [
            "Folder names are used as calendar dates because telemetry timestamps are match-relative.",
            "Numeric user IDs are bots; UUID-shaped user IDs are humans.",
            "The 2D minimap projection uses x and z. The y column is elevation and is intentionally ignored.",
            "Playback time is normalized to each match start, so multiple selected matches can be compared on the same timeline.",
            "Raw timestamp values behave like seconds stored in a timestamp[ms] column; deltas are converted to milliseconds for playback.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare gameplay telemetry for the static viewer.")
    parser.add_argument("--data-root", default="player_data", type=Path)
    parser.add_argument("--out", default="public/data/telemetry.json", type=Path)
    args = parser.parse_args()

    data_root = args.data_root
    out_path = args.out
    out_path.parent.mkdir(parents=True, exist_ok=True)

    payload = load_rows(data_root)
    ensure_minimaps(data_root, Path("."))

    with out_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, separators=(",", ":"))

    print(
        "Wrote {out} with {rows:,} rows, {matches:,} matches, {files:,} files.".format(
            out=out_path,
            rows=payload["summary"]["rowCount"],
            matches=payload["summary"]["matchCount"],
            files=payload["summary"]["loadedFiles"],
        )
    )


if __name__ == "__main__":
    main()
