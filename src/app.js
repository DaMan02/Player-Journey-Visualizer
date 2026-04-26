const MAP_SIZE = 1024;
const DATA_URL = "public/data/telemetry.json";

const MOVEMENT_EVENTS = new Set(["Position", "BotPosition"]);
const KILL_EVENTS = new Set(["Kill", "BotKill"]);
const DEATH_EVENTS = new Set(["Killed", "BotKilled"]);
const STORM_EVENTS = new Set(["KilledByStorm"]);
const LOOT_EVENTS = new Set(["Loot"]);

const state = {
  data: null,
  mapId: "",
  date: "all",
  matchId: "all",
  heatMode: "traffic",
  timeMs: 0,
  maxTimeMs: 1,
  playing: false,
  lastFrame: 0,
  speed: 4,
  showHumans: true,
  showBots: true,
  showPaths: true,
  showMarkers: true,
};

const els = {
  dataStatus: document.getElementById("dataStatus"),
  mapSelect: document.getElementById("mapSelect"),
  dateSelect: document.getElementById("dateSelect"),
  matchSelect: document.getElementById("matchSelect"),
  playButton: document.getElementById("playButton"),
  speedSelect: document.getElementById("speedSelect"),
  timeRange: document.getElementById("timeRange"),
  timeLabel: document.getElementById("timeLabel"),
  heatSelect: document.getElementById("heatSelect"),
  showHumans: document.getElementById("showHumans"),
  showBots: document.getElementById("showBots"),
  showPaths: document.getElementById("showPaths"),
  showMarkers: document.getElementById("showMarkers"),
  activeScope: document.getElementById("activeScope"),
  activeTitle: document.getElementById("activeTitle"),
  mapStage: document.getElementById("mapStage"),
  mapImage: document.getElementById("mapImage"),
  heatCanvas: document.getElementById("heatCanvas"),
  pathCanvas: document.getElementById("pathCanvas"),
  markerCanvas: document.getElementById("markerCanvas"),
  tooltip: document.getElementById("tooltip"),
  metricsGrid: document.getElementById("metricsGrid"),
  matchTable: document.getElementById("matchTable"),
};

const ctx = {
  heat: els.heatCanvas.getContext("2d"),
  path: els.pathCanvas.getContext("2d"),
  marker: els.markerCanvas.getContext("2d"),
};

let activeMarkers = [];

async function boot() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    state.data = await response.json();
    hydrateControls();
    refreshAfterFilterChange(false);
    render();
    const summary = state.data.summary;
    els.dataStatus.textContent = `${summary.rowCount.toLocaleString()} events, ${summary.matchCount.toLocaleString()} matches, ${summary.loadedFiles.toLocaleString()} files`;
  } catch (error) {
    els.dataStatus.textContent = `Telemetry load failed: ${error.message}`;
  }
}

function hydrateControls() {
  const maps = Object.entries(state.data.maps);
  const busiestMap = maps
    .map(([id]) => [id, state.data.summary.maps[id]?.rowCount || 0])
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  state.mapId = busiestMap || maps[0][0];

  els.mapSelect.innerHTML = maps
    .map(([id, config]) => `<option value="${id}">${escapeHtml(config.label)}</option>`)
    .join("");
  els.mapSelect.value = state.mapId;

  els.dateSelect.innerHTML = [
    `<option value="all">All dates</option>`,
    ...state.data.dates.map((date) => `<option value="${date}">${date}</option>`),
  ].join("");

  bindEvents();
}

function bindEvents() {
  els.mapSelect.addEventListener("change", () => {
    state.mapId = els.mapSelect.value;
    state.matchId = "all";
    refreshAfterFilterChange(false);
    render();
  });

  els.dateSelect.addEventListener("change", () => {
    state.date = els.dateSelect.value;
    state.matchId = "all";
    refreshAfterFilterChange(false);
    render();
  });

  els.matchSelect.addEventListener("change", () => {
    state.matchId = els.matchSelect.value;
    refreshAfterFilterChange(false);
    render();
  });

  els.timeRange.addEventListener("input", () => {
    state.timeMs = Number(els.timeRange.value);
    render();
  });

  els.playButton.addEventListener("click", togglePlayback);
  els.speedSelect.addEventListener("change", () => {
    state.speed = Number(els.speedSelect.value);
  });

  els.heatSelect.addEventListener("change", () => {
    state.heatMode = els.heatSelect.value;
    render();
  });

  for (const [key, element] of [
    ["showHumans", els.showHumans],
    ["showBots", els.showBots],
    ["showPaths", els.showPaths],
    ["showMarkers", els.showMarkers],
  ]) {
    element.addEventListener("change", () => {
      state[key] = element.checked;
      render();
    });
  }

  els.matchTable.addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-match-id]");
    if (!row) {
      return;
    }
    state.matchId = row.dataset.matchId;
    els.matchSelect.value = state.matchId;
    refreshAfterFilterChange(false);
    render();
  });

  els.mapStage.addEventListener("mousemove", handlePointerMove);
  els.mapStage.addEventListener("mouseleave", () => {
    els.tooltip.hidden = true;
  });
}

function refreshAfterFilterChange(preserveTime) {
  const matchOptions = filteredMatches({ ignoreMatch: true });
  updateMatchOptions(matchOptions);
  const matches = filteredMatches();
  state.maxTimeMs = Math.max(1, ...matches.map((match) => match.durationMs));

  if (!preserveTime) {
    state.timeMs = state.maxTimeMs;
  }
  state.timeMs = Math.min(state.timeMs, state.maxTimeMs);

  els.timeRange.max = String(state.maxTimeMs);
  els.timeRange.value = String(state.timeMs);
  els.timeLabel.value = formatTime(state.timeMs);
}

function updateMatchOptions(matches) {
  const available = matches.map((match) => match.id);
  if (state.matchId !== "all" && !available.includes(state.matchId)) {
    state.matchId = "all";
  }

  const options = [`<option value="all">All matches</option>`];
  for (const match of matches) {
    options.push(`<option value="${match.id}">${escapeHtml(matchLabel(match))}</option>`);
  }
  els.matchSelect.innerHTML = options.join("");
  els.matchSelect.value = state.matchId;
}

function filteredMatches(options = {}) {
  if (!state.data) {
    return [];
  }
  return state.data.matchIndex.filter((match) => {
    if (match.mapId !== state.mapId) {
      return false;
    }
    if (state.date !== "all" && match.date !== state.date) {
      return false;
    }
    if (!options.ignoreMatch && state.matchId !== "all" && match.id !== state.matchId) {
      return false;
    }
    return true;
  });
}

function visiblePlayers(matches) {
  const rows = [];
  for (const match of matches) {
    const players = state.data.playersByMatch[match.id] || [];
    for (const player of players) {
      if (!includePlayer(player)) {
        continue;
      }
      rows.push({ match, player });
    }
  }
  return rows;
}

function includePlayer(player) {
  if (player.kind === "human" && !state.showHumans) {
    return false;
  }
  if (player.kind === "bot" && !state.showBots) {
    return false;
  }
  return true;
}

function render() {
  if (!state.data) {
    return;
  }
  const matches = filteredMatches();
  const players = visiblePlayers(matches);
  const mapConfig = state.data.maps[state.mapId];

  els.mapImage.src = mapConfig.image;
  els.mapImage.alt = `${mapConfig.label} minimap`;
  els.activeScope.textContent = scopeLabel(matches);
  els.activeTitle.textContent = mapConfig.label;
  els.timeRange.value = String(state.timeMs);
  els.timeLabel.value = formatTime(state.timeMs);

  clearCanvas(ctx.heat);
  clearCanvas(ctx.path);
  clearCanvas(ctx.marker);
  activeMarkers = [];

  drawHeatmap(players);
  if (state.showPaths) {
    drawPaths(players);
  }
  if (state.showMarkers) {
    drawMarkers(players);
  }
  updateMetrics(matches, players);
  updateMatchTable(matches);
}

function drawHeatmap(players) {
  if (state.heatMode === "off") {
    return;
  }
  const context = ctx.heat;
  context.save();
  context.globalCompositeOperation = "lighter";

  for (const { player } of players) {
    for (const eventRow of player.events) {
      if (eventRow[0] > state.timeMs) {
        break;
      }
      const eventName = eventNameFor(eventRow);
      if (!eventBelongsToHeatMode(eventName)) {
        continue;
      }
      drawHeatPoint(context, eventRow[1], eventRow[2], heatPalette(state.heatMode));
    }
  }

  context.restore();
}

function drawHeatPoint(context, x, y, palette) {
  const radius = palette.radius;
  const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, palette.inner);
  gradient.addColorStop(0.45, palette.mid);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function drawPaths(players) {
  const context = ctx.path;
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";

  for (const { player } of players) {
    const isHuman = player.kind === "human";
    context.strokeStyle = isHuman ? "rgba(34, 184, 160, 0.74)" : "rgba(226, 184, 79, 0.58)";
    context.lineWidth = isHuman ? 2.2 : 1.35;
    context.setLineDash(isHuman ? [] : [7, 7]);

    let started = false;
    context.beginPath();
    for (const eventRow of player.events) {
      if (eventRow[0] > state.timeMs) {
        break;
      }
      const eventName = eventNameFor(eventRow);
      if (!MOVEMENT_EVENTS.has(eventName)) {
        continue;
      }
      if (!started) {
        context.moveTo(eventRow[1], eventRow[2]);
        started = true;
      } else {
        context.lineTo(eventRow[1], eventRow[2]);
      }
    }
    if (started) {
      context.stroke();
    }
  }
  context.restore();
}

function drawMarkers(players) {
  const context = ctx.marker;
  context.save();
  for (const { match, player } of players) {
    for (const eventRow of player.events) {
      if (eventRow[0] > state.timeMs) {
        break;
      }
      const eventName = eventNameFor(eventRow);
      if (MOVEMENT_EVENTS.has(eventName)) {
        continue;
      }
      drawEventMarker(context, eventName, eventRow[1], eventRow[2], player.kind);
      activeMarkers.push({
        x: eventRow[1],
        y: eventRow[2],
        eventName,
        playerId: player.id,
        playerKind: player.kind,
        matchId: match.shortId,
        timeMs: eventRow[0],
        worldX: eventRow[4],
        worldZ: eventRow[5],
      });
    }
  }
  context.restore();
}

function drawEventMarker(context, eventName, x, y, kind) {
  const size = kind === "human" ? 9 : 7;
  context.save();
  context.lineWidth = 2;
  context.shadowColor = "rgba(0,0,0,0.65)";
  context.shadowBlur = 5;

  if (KILL_EVENTS.has(eventName)) {
    context.fillStyle = "#ef635f";
    context.strokeStyle = "#2c0909";
    context.beginPath();
    context.moveTo(x, y - size);
    context.lineTo(x + size, y + size);
    context.lineTo(x - size, y + size);
    context.closePath();
    context.fill();
    context.stroke();
  } else if (DEATH_EVENTS.has(eventName)) {
    context.strokeStyle = "#f3f4f1";
    context.beginPath();
    context.moveTo(x - size, y - size);
    context.lineTo(x + size, y + size);
    context.moveTo(x + size, y - size);
    context.lineTo(x - size, y + size);
    context.stroke();
  } else if (STORM_EVENTS.has(eventName)) {
    context.fillStyle = "#b78cff";
    context.strokeStyle = "#231333";
    context.beginPath();
    context.moveTo(x, y - size);
    context.lineTo(x + size, y);
    context.lineTo(x, y + size);
    context.lineTo(x - size, y);
    context.closePath();
    context.fill();
    context.stroke();
  } else if (LOOT_EVENTS.has(eventName)) {
    context.fillStyle = "#5aa9ff";
    context.strokeStyle = "#061323";
    context.fillRect(x - size, y - size, size * 2, size * 2);
    context.strokeRect(x - size, y - size, size * 2, size * 2);
  }

  context.restore();
}

function eventBelongsToHeatMode(eventName) {
  if (state.heatMode === "traffic") {
    return MOVEMENT_EVENTS.has(eventName);
  }
  if (state.heatMode === "kills") {
    return KILL_EVENTS.has(eventName);
  }
  if (state.heatMode === "deaths") {
    return DEATH_EVENTS.has(eventName);
  }
  if (state.heatMode === "storm") {
    return STORM_EVENTS.has(eventName);
  }
  if (state.heatMode === "loot") {
    return LOOT_EVENTS.has(eventName);
  }
  return false;
}

function heatPalette(mode) {
  const palettes = {
    traffic: {
      radius: 22,
      inner: "rgba(34,184,160,0.16)",
      mid: "rgba(143,203,107,0.07)",
    },
    kills: {
      radius: 42,
      inner: "rgba(239,99,95,0.30)",
      mid: "rgba(226,184,79,0.12)",
    },
    deaths: {
      radius: 44,
      inner: "rgba(255,255,255,0.24)",
      mid: "rgba(239,99,95,0.10)",
    },
    storm: {
      radius: 50,
      inner: "rgba(183,140,255,0.28)",
      mid: "rgba(183,140,255,0.11)",
    },
    loot: {
      radius: 34,
      inner: "rgba(90,169,255,0.24)",
      mid: "rgba(34,184,160,0.09)",
    },
  };
  return palettes[mode] || palettes.traffic;
}

function updateMetrics(matches, players) {
  const metrics = {
    matches: matches.length,
    players: players.length,
    humans: players.filter(({ player }) => player.kind === "human").length,
    bots: players.filter(({ player }) => player.kind === "bot").length,
    kills: 0,
    deaths: 0,
    loot: 0,
    storm: 0,
    rows: 0,
  };

  for (const { player } of players) {
    for (const eventRow of player.events) {
      if (eventRow[0] > state.timeMs) {
        break;
      }
      const eventName = eventNameFor(eventRow);
      metrics.rows += 1;
      if (KILL_EVENTS.has(eventName)) {
        metrics.kills += 1;
      } else if (DEATH_EVENTS.has(eventName)) {
        metrics.deaths += 1;
      } else if (LOOT_EVENTS.has(eventName)) {
        metrics.loot += 1;
      } else if (STORM_EVENTS.has(eventName)) {
        metrics.storm += 1;
      }
    }
  }

  const rows = [
    ["Matches", metrics.matches],
    ["Players", metrics.players],
    ["Humans", metrics.humans],
    ["Bots", metrics.bots],
    ["Events", metrics.rows],
    ["Kills", metrics.kills],
    ["Deaths", metrics.deaths + metrics.storm],
    ["Loot", metrics.loot],
  ];

  els.metricsGrid.innerHTML = rows
    .map(([label, value]) => `<div class="metric"><strong>${value.toLocaleString()}</strong><span>${label}</span></div>`)
    .join("");
}

function updateMatchTable(matches) {
  const rows = matches.slice(0, 80).map((match) => {
    const events = Object.values(match.eventCounts).reduce((sum, value) => sum + value, 0);
    const active = match.id === state.matchId ? " class=\"active\"" : "";
    return `
      <tr data-match-id="${match.id}"${active}>
        <td>${escapeHtml(match.shortId)}</td>
        <td>${match.date.slice(5)}</td>
        <td>${match.humanCount}/${match.botCount}</td>
        <td>${events.toLocaleString()}</td>
      </tr>
    `;
  });
  els.matchTable.innerHTML = rows.join("");
}

function togglePlayback() {
  state.playing = !state.playing;
  els.playButton.textContent = state.playing ? "Pause" : "Play";
  state.lastFrame = performance.now();
  if (state.playing && state.timeMs >= state.maxTimeMs) {
    state.timeMs = 0;
  }
  requestAnimationFrame(tick);
}

function tick(now) {
  if (!state.playing) {
    return;
  }
  const delta = now - state.lastFrame;
  state.lastFrame = now;
  state.timeMs += delta * state.speed;
  if (state.timeMs >= state.maxTimeMs) {
    state.timeMs = state.maxTimeMs;
    state.playing = false;
    els.playButton.textContent = "Play";
  }
  render();
  if (state.playing) {
    requestAnimationFrame(tick);
  }
}

function handlePointerMove(event) {
  if (!activeMarkers.length) {
    els.tooltip.hidden = true;
    return;
  }

  const rect = els.mapStage.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * MAP_SIZE;
  const y = ((event.clientY - rect.top) / rect.height) * MAP_SIZE;
  let best = null;
  let bestDistance = Infinity;

  for (const marker of activeMarkers) {
    const distance = Math.hypot(marker.x - x, marker.y - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = marker;
    }
  }

  if (!best || bestDistance > 18) {
    els.tooltip.hidden = true;
    return;
  }

  els.tooltip.innerHTML = `
    <strong>${escapeHtml(best.eventName)}</strong><br>
    ${escapeHtml(best.playerKind)} ${escapeHtml(shortPlayer(best.playerId))}<br>
    Match ${escapeHtml(best.matchId)} at ${formatTime(best.timeMs)}<br>
    x ${best.worldX.toFixed(1)}, z ${best.worldZ.toFixed(1)}
  `;
  els.tooltip.style.left = `${Math.min(rect.width - 260, Math.max(8, event.clientX - rect.left + 12))}px`;
  els.tooltip.style.top = `${Math.max(8, event.clientY - rect.top + 12)}px`;
  els.tooltip.hidden = false;
}

function scopeLabel(matches) {
  const datePart = state.date === "all" ? "All dates" : state.date;
  const matchPart = state.matchId === "all" ? `${matches.length} matches` : "1 match";
  return `${datePart} / ${matchPart}`;
}

function matchLabel(match) {
  return `${match.shortId} | ${match.date} | ${match.humanCount}H ${match.botCount}B`;
}

function eventNameFor(eventRow) {
  return state.data.eventTypes[eventRow[3]] || "Unknown";
}

function clearCanvas(context) {
  context.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
}

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function shortPlayer(playerId) {
  return playerId.length > 12 ? playerId.slice(0, 8) : playerId;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

boot();
