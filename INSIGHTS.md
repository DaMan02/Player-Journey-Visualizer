# Insights

## 1. Combat is overwhelmingly bot-driven

What caught my eye: PvP events are almost absent in this slice. The dataset has `2,415` `BotKill` events and `700` `BotKilled` events, compared with only `3` human `Kill` and `3` human `Killed` events.

Why a level designer should care: most combat pressure players experience here is coming from bot placement, bot patrol paths, and bot-adjacent cover, not from player-vs-player rotations.

Action: review bot spawn density and sightlines in the top combat heatmap cells first. The metrics most likely to move are bot death rate, player death rate to bots, time-to-extract, and extraction success.

## 2. Movement is concentrated into a small set of cells

What caught my eye: each map has about one-third of all movement packed into the top 10% of occupied 64px grid cells. Ambrose Valley has `35.1%` of movement in its top `13` cells, Grand Rift has `35.3%` in its top `12`, and Lockdown has `34.0%` in its top `10`.

Concrete hotspots: Ambrose Valley's strongest combat cells include grid `8,8` with `143` kills and grid `6,7` with `136` kills. Lockdown's grid `9,8` has `38` kills and `20` deaths, making it a clear fight cluster.

Action: use the traffic heatmap to identify ignored regions, then add route incentives, safer traversal options, loot, or objective pressure outside the dominant cells. Track route diversity, loot pickups per region, and deaths per region after changes.

## 3. Storm pressure is proportionally higher on Lockdown and Grand Rift

What caught my eye: Ambrose Valley and Lockdown both have `17` storm deaths, but Ambrose Valley represents `68.5%` of all rows while Lockdown represents `23.8%`. That works out to `2.8` storm deaths per 10k rows on Ambrose Valley versus `8.0` on Lockdown. Grand Rift is also elevated at `7.3` per 10k rows.

Why a level designer should care: storm deaths can be healthy pressure, but high proportional storm deaths on smaller or lower-volume maps can also signal unclear extraction routes, harsh rotation timing, or poor warning readability.

Action: inspect storm-death markers against extraction routes on Lockdown and Grand Rift. Candidate changes are clearer pathing landmarks, earlier warning beats, or route timing adjustments. Watch storm death rate, late-match abandonment, extraction success, and average match duration.

