/**
 * ACE Indicator — All Cards Engine
 * Custom Home Assistant Lovelace card
 * File: /config/www/ace-indicator/ace-indicator.js
 * Resource: /local/ace-indicator/ace-indicator.js
 *
 * Modes: display | thresholds | boolean | graph
 * Themes: default | outline | soft | minimal
 */

const CARD_VERSION = "1.5.0";
const CARD_NAME = "ace-indicator";

/* ------------------------------------------------------------------ */
/*  Utility helpers                                                   */
/* ------------------------------------------------------------------ */
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const isNumeric = (v) => v !== null && v !== undefined && v !== "" && !isNaN(Number(v));

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : { r: 100, g: 100, b: 100 };
}

function pastel(hex, amount = 0.75) {
  const { r, g, b } = hexToRgb(hex);
  const nr = Math.round(r + (255 - r) * amount);
  const ng = Math.round(g + (255 - g) * amount);
  const nb = Math.round(b + (255 - b) * amount);
  return `rgb(${nr},${ng},${nb})`;
}

function darker(hex, amount = 0.35) {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${Math.round(r * (1 - amount))},${Math.round(g * (1 - amount))},${Math.round(b * (1 - amount))})`;
}

const DEFAULT_ICONS = [
  "mdi:circle",
  "mdi:printer",
  "mdi:printer-3d",
  "mdi:thermometer",
  "mdi:water-percent",
  "mdi:battery",
  "mdi:battery-high",
  "mdi:gauge",
  "mdi:chart-line",
  "mdi:lightning-bolt",
  "mdi:home",
  "mdi:server",
  "mdi:chip",
  "mdi:fan",
  "mdi:lightbulb",
  "mdi:power",
  "none",
];

/* ------------------------------------------------------------------ */
/*  Main Card                                                         */
/* ------------------------------------------------------------------ */
class AceIndicator extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = null;
    this._historyCache = {};
    this._lastHistoryFetch = 0;
    this._historyLoading = false;
    this._canvas = null;
    this._ro = null;
    this._roTimer = null;
  }

  disconnectedCallback() {
    if (this._ro) {
      this._ro.disconnect();
      this._ro = null;
    }
    if (this._roTimer) {
      clearTimeout(this._roTimer);
      this._roTimer = null;
    }
  }

  _ensureResizeObserver() {
    if (this._ro || typeof ResizeObserver === "undefined") return;
    this._ro = new ResizeObserver(() => {
      // Debounce redraws while the section is being resized
      if (this._roTimer) clearTimeout(this._roTimer);
      this._roTimer = setTimeout(() => {
        if (this._config?.mode === "graph" && this._canvas && this._historyCache?.ready) {
          this._drawSparkline();
        }
      }, 50);
    });
    this._ro.observe(this);
  }

  static getStubConfig() {
    return {
      mode: "display",
      name: "Status",
      icon: "mdi:circle",
      theme: "default",
      height: 36,
      width: 140,
      display_color: "#4caf50",
      entities: [{ entity: "sensor.example" }],
      show_value: true,
    };
  }

  static getConfigElement() {
    return document.createElement("ace-indicator-editor");
  }

  setConfig(config) {
    if (!config) {
      console.warn("ACE Indicator: empty config");
      return;
    }

    // Normalize entities – accept many common formats:
    //   entity: "sensor.x"
    //   entities: ["sensor.x", "sensor.y"]
    //   entities: [{ entity: "sensor.x" }, { entity_id: "sensor.y" }]
    let entities = [];
    if (Array.isArray(config.entities) && config.entities.length) {
      entities = config.entities.map((e) => {
        if (typeof e === "string") return { entity: e };
        if (e && typeof e === "object") {
          const id = e.entity || e.entity_id || e.id || "";
          return { ...e, entity: id };
        }
        return { entity: "" };
      });
    } else if (config.entity) {
      entities = [{ entity: config.entity }];
    } else if (config.entity_id) {
      entities = [{ entity: config.entity_id }];
    }
    entities = entities.filter((e) => e.entity);

    this._config = {
      mode: "display",
      name: "",
      icon: "mdi:circle",
      theme: "default",
      align: "center",
      height: 36,
      width: 140,
      icon_size: 18,
      name_size: 12,
      value_size: 14,
      display_color: "#4caf50",
      show_value: true,
      logic: "or",
      true_color: "#4caf50",
      true_label: "True",
      false_color: "#f44336",
      false_label: "False",
      hours_to_show: 24,
      graph_type: "sparkline",
      time_format: "24h",
      entities: [],
      thresholds: [
        { max: 20, color: "#f44336", label: "Low" },
        { max: 50, color: "#ff9800", label: "Med" },
        { max: 100, color: "#4caf50", label: "OK" },
      ],
      ...config,
      entities, // override with normalized list
    };

    // Force single entity in display mode
    if (this._config.mode === "display" && this._config.entities.length > 1) {
      this._config.entities = [this._config.entities[0]];
    }

    try {
      this._render();
    } catch (err) {
      console.error("ACE Indicator setConfig render error", err);
    }
  }

  set hass(hass) {
    this._hass = hass;
    try {
      if (!this._config || !this._config.entities?.length) {
        this._render();
        return;
      }

      if (this._config.mode === "graph") {
        this._updateGraph();
      } else {
        this._render();
      }
    } catch (err) {
      console.error("ACE Indicator hass update error", err);
    }
  }

  getCardSize() {
    // Lovelace uses this for layout + edit-mode hit area.
    // Scale with configured height in ALL modes so the hover/pencil region matches the card.
    const h = Number(this._config?.height) || 36;
    // ~50px per masonry row is a reasonable unit
    return Math.max(1, Math.ceil(h / 50));
  }

  /* -------------------- Rendering -------------------- */
  _render() {
    if (!this.shadowRoot) return;

    try {
      const cfg = this._config || {};
      const height = Math.max(24, Number(cfg.height) || 36);
      const width = Math.max(60, Number(cfg.width) || 140);
      const theme = cfg.theme || "default";

      // Graph mode fills the section width; other modes use configured pixel width.
      if (cfg.mode === "graph") {
        this.style.width = "100%";
        this.style.maxWidth = "100%";
      } else {
        this.style.width = `${width}px`;
        this.style.maxWidth = "100%";
      }
      this.style.display = "block";
      this.style.boxSizing = "border-box";
      this._ensureResizeObserver();

      let statusColor = "#9e9e9e";
      let statusLabel = "No entities";
      let statusValue = "";
      let icon = cfg.icon || "mdi:circle";

      if (cfg.entities?.length && this._hass) {
        if (cfg.mode === "display") {
          ({ statusColor, statusLabel, statusValue } = this._computeDisplay());
        } else if (cfg.mode === "thresholds") {
          ({ statusColor, statusLabel, statusValue } = this._computeThresholds());
        } else if (cfg.mode === "boolean") {
          ({ statusColor, statusLabel, statusValue } = this._computeBoolean());
        } else if (cfg.mode === "graph") {
          statusColor = cfg.display_color || "#4caf50";
          statusLabel = cfg.name || "Graph";
          statusValue = this._getCurrentValues().join(" / ");
        }
      }

      if (icon === "none") icon = null;

      const styles = this._themeStyles(theme, statusColor, height, width);

      this.shadowRoot.innerHTML = `
        <style>
          :host {
            display: block;
            width: ${cfg.mode === "graph" ? "100%" : width + "px"};
            max-width: 100%;
            height: auto;
            box-sizing: border-box;
          }
          .indicator {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
            box-sizing: border-box;
            ${cfg.mode === "graph"
              ? `min-height: ${height}px; height: auto; padding: 10px 12px; justify-content: flex-start;`
              : `height: ${height}px; padding: 0 12px; justify-content: ${
                  (cfg.align || "center") === "left" ? "flex-start" :
                  (cfg.align || "center") === "right" ? "flex-end" : "center"
                };`}
            border-radius: 6px;
            font-family: var(--ha-font-family-body, Roboto, sans-serif);
            font-size: 13px;
            font-weight: 500;
            white-space: ${cfg.mode === "graph" ? "normal" : "nowrap"};
            user-select: none;
            transition: background 0.2s, border-color 0.2s, color 0.2s;
            ${styles.container}
          }
          .icon {
            display: flex;
            align-items: center;
            justify-content: center;
            width: ${Math.max(12, Number(cfg.icon_size) || 18) + 4}px;
            height: ${Math.max(12, Number(cfg.icon_size) || 18) + 4}px;
            flex-shrink: 0;
            ${styles.icon}
          }
          .icon ha-icon {
            --mdc-icon-size: ${Math.max(12, Number(cfg.icon_size) || 18)}px;
          }
          .text {
            display: flex;
            flex-direction: column;
            justify-content: center;
            line-height: 1.15;
            overflow: hidden;
            text-align: ${(cfg.align || "center") === "left" ? "left" : (cfg.align || "center") === "right" ? "right" : "center"};
          }
          .name {
            font-size: ${Math.max(10, Number(cfg.name_size) || 12)}px;
            opacity: 0.9;
            ${styles.text}
          }
          .value {
            font-size: ${Math.max(10, Number(cfg.value_size) || 14)}px;
            font-weight: 600;
            ${styles.text}
          }
          .graph-wrap {
            display: flex;
            flex-direction: column;
            gap: 4px;
            width: 100%;
          }
          canvas {
            width: 100%;
            height: ${Math.max(32, height > 48 ? height - 22 : 32)}px;
            display: block;
          }
          .no-entities {
            color: #9e9e9e;
            font-style: italic;
          }
        </style>
        <div class="indicator">
          ${cfg.mode === "graph" ? this._renderGraphShell(statusColor, statusLabel, statusValue, icon, height, width) : this._renderSimple(statusColor, statusLabel, statusValue, icon)}
        </div>
      `;

      if (cfg.mode === "graph") {
        this._canvas = this.shadowRoot.querySelector("canvas");
        if (this._canvas && this._historyCache?.ready) {
          // slight delay so layout has sizes
          requestAnimationFrame(() => this._drawSparkline());
        }
      }
    } catch (err) {
      console.error("ACE Indicator render error", err);
      this.shadowRoot.innerHTML = `<div style="padding:8px;color:#f44336;font-size:12px;">Indicator error – check console</div>`;
    }
  }

  _renderSimple(statusColor, statusLabel, statusValue, icon) {
    return `
      ${icon ? `<div class="icon"><ha-icon icon="${icon}"></ha-icon></div>` : ""}
      <div class="text">
        ${statusLabel ? `<div class="name">${statusLabel}</div>` : ""}
        ${statusValue !== "" && statusValue !== undefined ? `<div class="value">${statusValue}</div>` : ""}
      </div>
    `;
  }

  _renderGraphShell(statusColor, statusLabel, statusValue, icon, height, width) {
    const showValue = this._config.show_value !== false;
    // Leave room for header + legend so the plot never sits under the title
    const canvasH = Math.max(56, height > 90 ? height - 56 : 56);

    // Build simple legend from entities
    const legendItems = (this._config.entities || []).map((e, idx) => {
      const colors = [this._config.display_color || "#4caf50", "#2196f3", "#ff9800", "#e91e63", "#9c27b0", "#00bcd4"];
      const color = e.color || colors[idx % colors.length];
      const name = e.name || (this._hass?.states[e.entity]?.attributes?.friendly_name) || e.entity?.split(".").pop() || `Series ${idx + 1}`;
      return `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;font-size:11px;font-weight:500;color:var(--primary-text-color, #212121);">
        <span style="width:10px;height:3px;background:${color};border-radius:1px;display:inline-block;"></span>${name}
      </span>`;
    }).join("");

    const align = this._config.align || "center";
    const headerJustify =
      align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";

    return `
      <div class="graph-wrap" style="width:100%; display:flex; flex-direction:column; gap:8px;">
        <div style="display:flex; align-items:center; justify-content:${headerJustify}; width:100%; flex-shrink:0;">
          <div style="display:inline-flex; align-items:center; gap:6px;">
            ${icon ? `<div class="icon"><ha-icon icon="${icon}"></ha-icon></div>` : ""}
            <div class="text" style="text-align:left;">
              ${statusLabel ? `<div class="name">${statusLabel}</div>` : ""}
              ${showValue && statusValue ? `<div class="value">${statusValue}</div>` : ""}
            </div>
          </div>
        </div>
        <canvas height="${canvasH}" style="flex-shrink:0; display:block; width:100%;"></canvas>
        ${legendItems ? `<div class="legend" style="line-height:1.3; flex-shrink:0;">${legendItems}</div>` : ""}
      </div>
    `;
  }

  _themeStyles(theme, color, height, width) {
    switch (theme) {
      case "outline":
        return {
          container: `background: transparent; border: 2px solid ${color}; color: ${color};`,
          icon: `color: ${color};`,
          text: `color: ${color};`,
        };
      case "soft":
        return {
          container: `background: ${pastel(color, 0.82)}; border: 1px solid ${pastel(color, 0.55)}; color: ${darker(color, 0.45)};`,
          icon: `color: ${darker(color, 0.4)};`,
          text: `color: ${darker(color, 0.45)};`,
        };
      case "minimal":
        return {
          container: `background: transparent; border: none; color: ${color}; padding: 0 4px;`,
          icon: `color: ${color};`,
          text: `color: ${color};`,
        };
      default: // default
        return {
          container: `background: ${color}; border: none; color: #fff;`,
          icon: `color: #fff;`,
          text: `color: #fff;`,
        };
    }
  }

  /* -------------------- Mode logic -------------------- */
  _computeDisplay() {
    const ent = this._config.entities[0];
    if (!ent?.entity || !this._hass.states[ent.entity]) {
      return { statusColor: "#9e9e9e", statusLabel: "Unavailable", statusValue: "" };
    }
    const stateObj = this._hass.states[ent.entity];
    const unit = stateObj.attributes.unit_of_measurement || "";
    const val = stateObj.state;
    const color = this._config.display_color || "#4caf50";
    const name = this._config.name || stateObj.attributes.friendly_name || ent.entity;
    return {
      statusColor: color,
      statusLabel: name,
      statusValue: this._config.show_value !== false ? this._formatValueWithUnit(val, unit) : "",
    };
  }

  _computeThresholds() {
    const values = [];
    for (const e of this._config.entities || []) {
      const s = this._hass.states[e.entity];
      if (s && isNumeric(s.state)) values.push(Number(s.state));
    }
    if (!values.length) {
      return { statusColor: "#9e9e9e", statusLabel: "No data", statusValue: "" };
    }
    const lowest = Math.min(...values);
    const thresholds = (this._config.thresholds || []).slice().sort((a, b) => a.max - b.max);
    let matched = thresholds.find((t) => lowest <= t.max) || thresholds[thresholds.length - 1] || {
      color: "#9e9e9e",
      label: "Unknown",
    };
    const name = this._config.name || matched.label || "Status";
    const unit = this._firstUnit();
    return {
      statusColor: matched.color || "#9e9e9e",
      statusLabel: name,
      statusValue: this._config.show_value !== false ? this._formatValueWithUnit(lowest, unit) : "",
    };
  }

  _computeBoolean() {
    const logic = (this._config.logic || "or").toLowerCase();
    const conditions = this._config.entities || [];
    if (!conditions.length) {
      return { statusColor: "#9e9e9e", statusLabel: "No entities", statusValue: "" };
    }

    const results = conditions.map((c) => {
      const s = this._hass.states[c.entity];
      if (!s) return false;
      const val = isNumeric(s.state) ? Number(s.state) : s.state;
      const target = isNumeric(c.value) ? Number(c.value) : c.value;
      switch (c.condition || "==") {
        case ">": return val > target;
        case ">=": return val >= target;
        case "<": return val < target;
        case "<=": return val <= target;
        case "!=": return val != target;
        default: return val == target;
      }
    });

    const passed = logic === "and" ? results.every(Boolean) : results.some(Boolean);
    const color = passed ? this._config.true_color || "#4caf50" : this._config.false_color || "#f44336";
    const label = passed ? this._config.true_label || "True" : this._config.false_label || "False";
    const name = this._config.name || label;
    return {
      statusColor: color,
      statusLabel: name,
      statusValue: this._config.show_value !== false ? label : "",
    };
  }

  _firstUnit() {
    for (const e of this._config.entities || []) {
      const s = this._hass?.states[e.entity];
      if (s?.attributes?.unit_of_measurement) return s.attributes.unit_of_measurement;
    }
    return "";
  }

  // Currency / prefix-style units go before the number; everything else after.
  _formatValueWithUnit(val, unit) {
    if (!unit) return `${val}`;
    const u = String(unit).trim();
    const PREFIX_UNITS = ["$", "€", "£", "¥", "₹", "₩", "₽", "₪", "₱", "฿", "₫", "₴", "₦", "₡", "R$", "A$", "C$", "HK$", "NZ$", "US$"];
    if (PREFIX_UNITS.includes(u) || /^[A-Z]{0,3}\$$/.test(u)) {
      return `${u}${val}`;
    }
    return `${val} ${u}`;
  }

  _getCurrentValues() {
    const vals = [];
    for (const e of this._config.entities || []) {
      const s = this._hass?.states[e.entity];
      if (s) {
        const unit = s.attributes.unit_of_measurement || "";
        vals.push(this._formatValueWithUnit(s.state, unit));
      }
    }
    return vals;
  }

  /* -------------------- Graph Mode -------------------- */
  async _updateGraph() {
    if (!this._hass || this._historyLoading) return;
    const now = Date.now();
    // Refresh history at most every 60 s
    if (now - this._lastHistoryFetch < 60000 && this._historyCache.ready) {
      this._render();
      return;
    }

    this._historyLoading = true;
    const hours = Number(this._config.hours_to_show) || 24;
    const end = new Date();
    const start = new Date(end.getTime() - hours * 3600 * 1000);
    const entityIds = (this._config.entities || []).map((e) => e.entity).filter(Boolean);

    if (!entityIds.length) {
      this._historyCache = { ready: false };
      this._historyLoading = false;
      this._render();
      return;
    }

    try {
      const history = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        entity_ids: entityIds,
        significant_changes_only: false,
        minimal_response: true,
        no_attributes: true,
      });

      // history is an object keyed by entity_id → array of states
      this._historyCache = {
        ready: true,
        start: start.getTime(),
        end: end.getTime(),
        series: {},
      };

      for (const eid of entityIds) {
        const raw = history[eid] || [];
        const points = [];
        for (const p of raw) {
          let state, ts;
          // Support both object form {s, lu} and array form [ts, state]
          if (Array.isArray(p)) {
            ts = p[0];
            state = p[1];
          } else if (p && typeof p === "object") {
            state = p.s ?? p.state;
            ts = p.lu ?? p.last_updated ?? p.last_changed;
          }
          if (state === "unavailable" || state === "unknown" || !isNumeric(state)) continue;
          // ts may be seconds or milliseconds or ISO string
          let t;
          if (typeof ts === "number") {
            t = ts < 1e12 ? ts * 1000 : ts; // seconds → ms
          } else if (typeof ts === "string") {
            t = new Date(ts).getTime();
          } else {
            continue;
          }
          if (!isFinite(t)) continue;
          points.push({ t, v: Number(state) });
        }
        // Ensure chronological order
        points.sort((a, b) => a.t - b.t);
        this._historyCache.series[eid] = points;
      }

      this._lastHistoryFetch = now;
    } catch (err) {
      console.warn("ACE Indicator – history fetch failed", err);
      this._historyCache = { ready: false };
    }

    this._historyLoading = false;
    this._render();
  }

  _drawSparkline() {
    const canvas = this._canvas;
    if (!canvas || !this._historyCache?.ready) return;

    try {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;

      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      const seriesKeys = Object.keys(this._historyCache.series || {});
      if (!seriesKeys.length) return;

      // Collect global min/max
      let globalMin = Infinity;
      let globalMax = -Infinity;
      for (const key of seriesKeys) {
        for (const p of this._historyCache.series[key] || []) {
          if (p.v < globalMin) globalMin = p.v;
          if (p.v > globalMax) globalMax = p.v;
        }
      }
      if (!isFinite(globalMin) || !isFinite(globalMax)) return;
      if (globalMin === globalMax) {
        globalMin -= 1;
        globalMax += 1;
      }

      // Padding for axis labels – room for y-values and 12h time strings (e.g. 12:58PM)
      const padL = 36; // left for y-labels
      const padR = 28; // right so last time label isn't clipped
      const padT = 10;
      const padB = 22; // bottom for time labels
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;

      const startT = this._historyCache.start;
      const endT = this._historyCache.end;
      const rangeT = endT - startT || 1;
      const rangeV = globalMax - globalMin || 1;

      // On Default (solid) theme the outer background is the status color.
      // Give the plot a light card-like background so lines stay visible.
      const isSolid = (this._config.theme || "default") === "default";
      if (isSolid) {
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.fillRect(0, 0, w, h);
        // subtle border
        ctx.strokeStyle = "rgba(0,0,0,0.12)";
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
      }

      // ----- Grid -----
      // Dark readable labels to match the legend
      const labelColor = "rgba(33, 33, 33, 0.85)";
      ctx.strokeStyle = isSolid ? "rgba(0,0,0,0.12)" : "rgba(128,128,128,0.25)";
      ctx.lineWidth = 1;
      ctx.font = "10px var(--ha-font-family-body, Roboto, sans-serif)";
      ctx.fillStyle = labelColor;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";

      const yTicks = 4;
      for (let i = 0; i <= yTicks; i++) {
        const frac = i / yTicks;
        const y = padT + plotH * (1 - frac);
        const val = globalMin + rangeV * frac;
        // horizontal grid line
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(w - padR, y);
        ctx.stroke();
        // y label – keep bottom label above the axis so it doesn't hit time labels
        const label = Math.abs(val) >= 100 ? val.toFixed(0) : val.toFixed(1);
        ctx.textAlign = "right";
        if (i === 0) {
          ctx.textBaseline = "bottom";
          ctx.fillText(label, padL - 4, y - 2);
        } else {
          ctx.textBaseline = "middle";
          ctx.fillText(label, padL - 4, y);
        }
      }

      // vertical time markers (roughly 4)
      ctx.textBaseline = "top";
      const xTicks = 4;
      for (let i = 0; i <= xTicks; i++) {
        const frac = i / xTicks;
        const x = padL + plotW * frac;
        const t = startT + rangeT * frac;
        // vertical grid line
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + plotH);
        ctx.stroke();
        // time label – pin first/last so they aren't clipped
        const d = new Date(t);
        const mm = d.getMinutes().toString().padStart(2, "0");
        let timeLabel;
        if ((this._config.time_format || "24h") === "12h") {
          let h = d.getHours();
          const ampm = h >= 12 ? "PM" : "AM";
          h = h % 12 || 12;
          timeLabel = `${h}:${mm}${ampm}`;
        } else {
          timeLabel = `${d.getHours().toString().padStart(2, "0")}:${mm}`;
        }
        if (i === 0) ctx.textAlign = "left";
        else if (i === xTicks) ctx.textAlign = "right";
        else ctx.textAlign = "center";
        ctx.fillText(timeLabel, x, padT + plotH + 4);
      }

      // ----- Series -----
      const colors = [
        this._config.display_color || "#4caf50",
        "#2196f3",
        "#ff9800",
        "#e91e63",
        "#9c27b0",
        "#00bcd4",
      ];

      seriesKeys.forEach((eid, idx) => {
        const points = this._historyCache.series[eid];
        if (!points || points.length === 0) return;

        const color = (this._config.entities[idx]?.color) || colors[idx % colors.length];
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1.8;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        const toX = (t) => padL + ((t - startT) / rangeT) * plotW;
        const toY = (v) => padT + plotH - ((v - globalMin) / rangeV) * plotH;

        if (points.length === 1) {
          const p = points[0];
          const y = toY(p.v);
          ctx.beginPath();
          ctx.moveTo(padL, y);
          ctx.lineTo(w - padR, y);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(w - padR - 4, y, 2.5, 0, Math.PI * 2);
          ctx.fill();
          return;
        }

        // optional fill
        if (idx === 0 && this._config.graph_type !== "line") {
          ctx.beginPath();
          points.forEach((p, i) => {
            const x = toX(p.t);
            const y = toY(p.v);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.lineTo(toX(points[points.length - 1].t), padT + plotH);
          ctx.lineTo(toX(points[0].t), padT + plotH);
          ctx.closePath();
          ctx.fillStyle = color + "28";
          ctx.fill();
        }

        // line
        ctx.beginPath();
        points.forEach((p, i) => {
          const x = toX(p.t);
          const y = toY(p.v);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = color;
        ctx.stroke();
      });
    } catch (err) {
      console.warn("ACE Indicator sparkline draw error", err);
    }
  }
}

customElements.define(CARD_NAME, AceIndicator);

/* ------------------------------------------------------------------ */
/*  Editor                                                            */
/* ------------------------------------------------------------------ */
class AceIndicatorEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._helpers = null;
  }

  setConfig(config) {
    this._config = JSON.parse(JSON.stringify(config || {}));

    // Force sensible defaults so the form never shows blank height/width
    if (!this._config.height || this._config.height < 24) this._config.height = 36;
    if (!this._config.width || this._config.width < 60) this._config.width = 140;
    if (!this._config.theme) this._config.theme = "default";
    if (!this._config.mode) this._config.mode = "display";
    if (!this._config.align) this._config.align = "center";

    // Ensure thresholds always exist when in thresholds mode
    if (!Array.isArray(this._config.thresholds) || this._config.thresholds.length === 0) {
      this._config.thresholds = [
        { max: 20, color: "#f44336", label: "Low" },
        { max: 50, color: "#ff9800", label: "Med" },
        { max: 100, color: "#4caf50", label: "OK" },
      ];
    }

    // Normalize entities for the editor too
    let ents = [];
    if (Array.isArray(this._config.entities) && this._config.entities.length) {
      ents = this._config.entities.map((e) => {
        if (typeof e === "string") return { entity: e };
        if (e && typeof e === "object") {
          const id = e.entity || e.entity_id || e.id || "";
          return { ...e, entity: id };
        }
        return { entity: "" };
      });
    } else if (this._config.entity) {
      ents = [{ entity: this._config.entity }];
    }
    this._config.entities = ents.filter((e) => e.entity);
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    // Rebuild entity pickers once hass is available so the dropdown works
    if (this.shadowRoot?.getElementById("entities-container")) {
      this._buildEntityRows();
    }
  }

  async _loadHelpers() {
    if (this._helpers) return;
    this._helpers = await window.loadCardHelpers();
  }

  _fire(config) {
    const event = new CustomEvent("config-changed", {
      detail: { config },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
  }

  _update(key, value) {
    const newCfg = { ...this._config, [key]: value };
    // Enforce single entity in display mode
    if (key === "mode" && value === "display" && newCfg.entities?.length > 1) {
      newCfg.entities = [newCfg.entities[0]];
    }
    this._config = newCfg;
    this._fire(newCfg);
    this._render();
  }

  _updateEntity(idx, field, value) {
    const entities = [...(this._config.entities || [])];
    entities[idx] = { ...entities[idx], [field]: value };
    this._update("entities", entities);
  }

  _addEntity() {
    const entities = [...(this._config.entities || [])];
    if (this._config.mode === "display" && entities.length >= 1) return;
    entities.push({ entity: "" });
    this._update("entities", entities);
  }

  _removeEntity(idx) {
    const entities = [...(this._config.entities || [])];
    if (entities.length <= 1) return; // never remove last
    entities.splice(idx, 1);
    this._update("entities", entities);
  }

  _render() {
    const cfg = this._config;
    const mode = cfg.mode || "display";

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; padding: 4px; font-family: var(--ha-font-family-body); }
        .section {
          margin-bottom: 18px;
        }
        .section-title {
          font-size: 14px;
          font-weight: 600;
          margin-bottom: 6px;
          color: var(--primary-text-color);
        }
        .frame {
          border: 2px solid #000;
          border-radius: 6px;
          padding: 12px;
          background: var(--card-background-color, #fff);
        }
        label {
          display: block;
          font-size: 12px;
          font-weight: 500;
          margin: 8px 0 3px;
          color: var(--secondary-text-color);
        }
        input, select, textarea {
          width: 100%;
          box-sizing: border-box;
          padding: 7px 10px;
          border: 1px solid var(--divider-color, #ccc);
          border-radius: 4px;
          background: var(--card-background-color);
          color: var(--primary-text-color);
          font-size: 13px;
        }
        input[type="color"] {
          height: 34px;
          padding: 2px;
        }
        .row {
          display: flex;
          gap: 10px;
          align-items: flex-end;
        }
        .row > * { flex: 1; }
        .entity-row {
          display: flex;
          gap: 8px;
          align-items: center;
          margin-bottom: 8px;
          flex-wrap: nowrap;
        }
        .entity-row ha-entity-picker {
          display: block;
        }
        button {
          background: var(--primary-color);
          color: #fff;
          border: none;
          border-radius: 4px;
          padding: 6px 12px;
          font-size: 12px;
          cursor: pointer;
        }
        button.danger { background: #f44336; }
        button.secondary { background: var(--secondary-background-color); color: var(--primary-text-color); border: 1px solid var(--divider-color); }
        .hint {
          font-size: 11px;
          color: var(--secondary-text-color);
          margin-top: 4px;
        }
        .warning {
          background: #fff3cd;
          border: 1px solid #ffc107;
          padding: 8px;
          border-radius: 4px;
          font-size: 12px;
          margin-bottom: 10px;
        }
      </style>

      <!-- MODE -->
      <div class="section">
        <div class="section-title">Mode</div>
        <div class="frame">
          <select id="mode">
            <option value="display" ${mode === "display" ? "selected" : ""}>Display (simple)</option>
            <option value="thresholds" ${mode === "thresholds" ? "selected" : ""}>Thresholds</option>
            <option value="boolean" ${mode === "boolean" ? "selected" : ""}>Boolean Logic</option>
            <option value="graph" ${mode === "graph" ? "selected" : ""}>Graph (sparkline)</option>
          </select>
        </div>
      </div>

      <!-- GENERAL -->
      <div class="section">
        <div class="section-title">General</div>
        <div class="frame">
          <div class="row">
            <div style="flex:1">
              <label>Indicator Display Text</label>
              <input id="name" type="text" value="${cfg.name || ""}" placeholder="Optional name">
            </div>
            <div style="flex:1">
              <label>Icon</label>
              <select id="icon">
                ${DEFAULT_ICONS.map((i) => `<option value="${i}" ${cfg.icon === i ? "selected" : ""}>${i === "none" ? "None (hide icon)" : i}</option>`).join("")}
                <option value="other" ${cfg.icon && !DEFAULT_ICONS.includes(cfg.icon) ? "selected" : ""}>Other…</option>
              </select>
              <input id="icon-custom" type="text" value="${cfg.icon && !DEFAULT_ICONS.includes(cfg.icon) ? cfg.icon : ""}" placeholder="mdi:custom-icon" style="margin-top:4px; display:${cfg.icon && !DEFAULT_ICONS.includes(cfg.icon) ? "block" : "none"}">
            </div>
          </div>

          <div class="row" style="margin-top:4px">
            <div style="flex:1">
              <label>Theme</label>
              <select id="theme">
                <option value="default" ${cfg.theme === "default" ? "selected" : ""}>Default (solid)</option>
                <option value="outline" ${cfg.theme === "outline" ? "selected" : ""}>Outline</option>
                <option value="soft" ${cfg.theme === "soft" ? "selected" : ""}>Soft (pastel)</option>
                <option value="minimal" ${cfg.theme === "minimal" ? "selected" : ""}>Minimal</option>
              </select>
            </div>
            <div style="flex:1">
              <label>Alignment</label>
              <select id="align">
                <option value="left" ${cfg.align === "left" ? "selected" : ""}>Left</option>
                <option value="center" ${(cfg.align || "center") === "center" ? "selected" : ""}>Center</option>
                <option value="right" ${cfg.align === "right" ? "selected" : ""}>Right</option>
              </select>
            </div>
          </div>

          <div class="row">
            <div>
              <label>Height (px)</label>
              <input id="height" type="number" min="24" max="120" value="${cfg.height || 36}">
            </div>
            <div>
              <label>Width (px)</label>
              <input id="width" type="number" min="60" max="400" value="${cfg.width || 140}">
            </div>
          </div>
          <div class="hint">${mode === "graph"
            ? "Graph mode fills the section width — set columns in the Layout tab"
            : `Recommended Layout columns ≈ ${Math.max(3, Math.ceil((cfg.width || 140) / 40))} (give the card enough columns or it will shrink)`}</div>

          <div class="row" style="margin-top:8px">
            <div>
              <label>Icon size (px)</label>
              <input id="icon_size" type="number" min="12" max="48" value="${cfg.icon_size || 18}">
            </div>
            <div>
              <label>Name size (px)</label>
              <input id="name_size" type="number" min="10" max="32" value="${cfg.name_size || 12}">
            </div>
            <div>
              <label>Value size (px)</label>
              <input id="value_size" type="number" min="10" max="36" value="${cfg.value_size || 14}">
            </div>
          </div>

          <label style="margin-top:12px;display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="show_value" ${cfg.show_value !== false ? "checked" : ""} style="width:16px;height:16px;accent-color:var(--primary-color);">
            Show numeric value
          </label>
        </div>
      </div>

      <!-- ENTITIES -->
      <div class="section">
        <div class="section-title">Entities ${mode === "display" ? "(max 1 in Display mode)" : ""}</div>
        <div class="frame">
          ${!(cfg.entities?.length) ? `<div class="warning">⚠ No entities defined – add at least one</div>` : ""}
          <div id="entities-container"></div>
          <button id="add-entity" class="secondary" style="margin-top:6px" ${mode === "display" && (cfg.entities || []).length >= 1 ? "disabled" : ""}>+ Add entity</button>
        </div>
      </div>

      <!-- MODE-SPECIFIC -->
      ${mode === "display" ? `
        <div class="section">
          <div class="section-title">Display Mode</div>
          <div class="frame">
            <label>Display Color</label>
            <input id="display_color" type="color" value="${cfg.display_color || "#4caf50"}">
          </div>
        </div>
      ` : ""}

      ${mode === "thresholds" ? `
        <div class="section">
          <div class="section-title">Thresholds (first match ≤ max wins)</div>
          <div class="frame">
            <div class="hint" style="margin-bottom:8px">Uses the <strong>lowest</strong> numeric value among all entities. First matching max wins.</div>
            ${(cfg.thresholds && cfg.thresholds.length ? cfg.thresholds : [
                { max: 20, color: "#f44336", label: "Low" },
                { max: 50, color: "#ff9800", label: "Med" },
                { max: 100, color: "#4caf50", label: "OK" }
              ]).map((t, idx) => `
              <div class="row" style="margin-bottom:6px">
                <div>
                  <label>Max</label>
                  <input type="number" data-th="${idx}" data-field="max" value="${t.max ?? ""}">
                </div>
                <div>
                  <label>Color</label>
                  <input type="color" data-th="${idx}" data-field="color" value="${t.color || "#4caf50"}">
                </div>
                <div>
                  <label>Label</label>
                  <input type="text" data-th="${idx}" data-field="label" value="${t.label || ""}">
                </div>
                <div style="display:flex;align-items:flex-end;">
                  <button class="danger" data-th-remove="${idx}" style="margin-bottom:2px;" ${(cfg.thresholds || []).length <= 1 ? "disabled" : ""}>✕</button>
                </div>
              </div>
            `).join("")}
            <button id="add-threshold" class="secondary" style="margin-top:6px">+ Add threshold</button>
          </div>
        </div>
      ` : ""}

      ${mode === "boolean" ? `
        <div class="section">
          <div class="section-title">Boolean Logic</div>
          <div class="frame">
            <label>Logic</label>
            <select id="logic">
              <option value="or" ${cfg.logic === "or" ? "selected" : ""}>OR (any condition true)</option>
              <option value="and" ${cfg.logic === "and" ? "selected" : ""}>AND (all conditions true)</option>
            </select>
            <div class="row" style="margin-top:10px">
              <div>
                <label>True Color</label>
                <input id="true_color" type="color" value="${cfg.true_color || "#4caf50"}">
              </div>
              <div>
                <label>True Label</label>
                <input id="true_label" type="text" value="${cfg.true_label || "True"}">
              </div>
            </div>
            <div class="row">
              <div>
                <label>False Color</label>
                <input id="false_color" type="color" value="${cfg.false_color || "#f44336"}">
              </div>
              <div>
                <label>False Label</label>
                <input id="false_label" type="text" value="${cfg.false_label || "False"}">
              </div>
            </div>
          </div>
        </div>
      ` : ""}

      ${mode === "graph" ? `
        <div class="section">
          <div class="section-title">Graph Mode</div>
          <div class="frame">
            <label>Hours to show</label>
            <input id="hours_to_show" type="number" min="1" max="168" value="${cfg.hours_to_show || 24}">
            <div class="hint">History is refreshed every ~60 seconds</div>

            <label>Time format</label>
            <select id="time_format">
              <option value="24h" ${(cfg.time_format || "24h") === "24h" ? "selected" : ""}>24-hour (14:30)</option>
              <option value="12h" ${cfg.time_format === "12h" ? "selected" : ""}>12-hour (2:30PM)</option>
            </select>

            <label>Graph style</label>
            <select id="graph_type">
              <option value="sparkline" ${cfg.graph_type === "sparkline" ? "selected" : ""}>Sparkline (filled)</option>
              <option value="line" ${cfg.graph_type === "line" ? "selected" : ""}>Line only</option>
            </select>
          </div>
        </div>
      ` : ""}
    `;

    // Event listeners
    this.shadowRoot.getElementById("mode")?.addEventListener("change", (e) => this._update("mode", e.target.value));
    this.shadowRoot.getElementById("name")?.addEventListener("change", (e) => this._update("name", e.target.value));
    this.shadowRoot.getElementById("theme")?.addEventListener("change", (e) => this._update("theme", e.target.value));
    this.shadowRoot.getElementById("align")?.addEventListener("change", (e) => this._update("align", e.target.value));
    this.shadowRoot.getElementById("height")?.addEventListener("change", (e) => {
      const v = Number(e.target.value);
      this._update("height", !v || v < 24 ? 36 : v);
    });
    this.shadowRoot.getElementById("width")?.addEventListener("change", (e) => {
      const v = Number(e.target.value);
      this._update("width", !v || v < 60 ? 140 : v);
    });
    this.shadowRoot.getElementById("icon_size")?.addEventListener("change", (e) => {
      const v = Number(e.target.value);
      this._update("icon_size", !v || v < 12 ? 18 : Math.min(48, v));
    });
    this.shadowRoot.getElementById("name_size")?.addEventListener("change", (e) => {
      const v = Number(e.target.value);
      this._update("name_size", !v || v < 10 ? 12 : Math.min(32, v));
    });
    this.shadowRoot.getElementById("value_size")?.addEventListener("change", (e) => {
      const v = Number(e.target.value);
      this._update("value_size", !v || v < 10 ? 14 : Math.min(36, v));
    });
    this.shadowRoot.getElementById("show_value")?.addEventListener("change", (e) => this._update("show_value", e.target.checked));
    this.shadowRoot.getElementById("display_color")?.addEventListener("change", (e) => this._update("display_color", e.target.value));
    this.shadowRoot.getElementById("logic")?.addEventListener("change", (e) => this._update("logic", e.target.value));
    this.shadowRoot.getElementById("true_color")?.addEventListener("change", (e) => this._update("true_color", e.target.value));
    this.shadowRoot.getElementById("true_label")?.addEventListener("change", (e) => this._update("true_label", e.target.value));
    this.shadowRoot.getElementById("false_color")?.addEventListener("change", (e) => this._update("false_color", e.target.value));
    this.shadowRoot.getElementById("false_label")?.addEventListener("change", (e) => this._update("false_label", e.target.value));
    this.shadowRoot.getElementById("hours_to_show")?.addEventListener("change", (e) => this._update("hours_to_show", Number(e.target.value)));
    this.shadowRoot.getElementById("time_format")?.addEventListener("change", (e) => this._update("time_format", e.target.value));
    this.shadowRoot.getElementById("graph_type")?.addEventListener("change", (e) => this._update("graph_type", e.target.value));

    // Icon handling
    const iconSelect = this.shadowRoot.getElementById("icon");
    const iconCustom = this.shadowRoot.getElementById("icon-custom");
    iconSelect?.addEventListener("change", (e) => {
      if (e.target.value === "other") {
        iconCustom.style.display = "block";
        iconCustom.focus();
      } else {
        iconCustom.style.display = "none";
        this._update("icon", e.target.value);
      }
    });
    iconCustom?.addEventListener("change", (e) => this._update("icon", e.target.value || "mdi:circle"));

    // Build entity rows with real ha-entity-picker
    this._buildEntityRows();

    this.shadowRoot.getElementById("add-entity")?.addEventListener("click", () => this._addEntity());

    // Thresholds – edit existing
    this.shadowRoot.querySelectorAll("[data-th]").forEach((el) => {
      el.addEventListener("change", (e) => {
        const idx = Number(e.target.dataset.th);
        const field = e.target.dataset.field;
        const thresholds = [...(this._config.thresholds || [])];
        if (!thresholds[idx]) thresholds[idx] = {};
        thresholds[idx] = {
          ...thresholds[idx],
          [field]: field === "max" ? Number(e.target.value) : e.target.value,
        };
        this._update("thresholds", thresholds);
      });
    });

    // Thresholds – remove
    this.shadowRoot.querySelectorAll("[data-th-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.thRemove);
        const thresholds = [...(this._config.thresholds || [])];
        if (thresholds.length <= 1) return;
        thresholds.splice(idx, 1);
        this._update("thresholds", thresholds);
      });
    });

    // Thresholds – add
    this.shadowRoot.getElementById("add-threshold")?.addEventListener("click", () => {
      const thresholds = [...(this._config.thresholds || [])];
      thresholds.push({ max: 100, color: "#4caf50", label: "New" });
      this._update("thresholds", thresholds);
    });
  }

  _buildEntityRows() {
    const container = this.shadowRoot.getElementById("entities-container");
    if (!container) return;
    container.innerHTML = "";

    const mode = this._config.mode || "display";
    const entities = this._config.entities || [];

    // Fixed widths so rows don't jump when switching modes
    const PICKER_WIDTH = "220px";
    const COLOR_WIDTH = "36px";
    const COND_WIDTH = "64px";
    const VALUE_WIDTH = "72px";
    const BTN_WIDTH = "32px";

    entities.forEach((e, idx) => {
      const row = document.createElement("div");
      row.className = "entity-row";
      row.style.cssText = "display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:nowrap;";

      // Real HA entity picker – fixed width
      const picker = document.createElement("ha-entity-picker");
      picker.hass = this._hass;
      picker.value = e.entity || "";
      picker.allowCustomEntity = true;
      picker.style.cssText = `width:${PICKER_WIDTH};min-width:${PICKER_WIDTH};max-width:${PICKER_WIDTH};flex:0 0 ${PICKER_WIDTH};`;
      picker.addEventListener("value-changed", (ev) => {
        this._updateEntity(idx, "entity", ev.detail.value);
      });
      row.appendChild(picker);

      // Boolean extras – fixed widths
      if (mode === "boolean") {
        const cond = document.createElement("select");
        cond.style.cssText = `width:${COND_WIDTH};min-width:${COND_WIDTH};flex:0 0 ${COND_WIDTH};`;
        [">", ">=", "<", "<=", "==", "!="].forEach((op) => {
          const opt = document.createElement("option");
          opt.value = op;
          opt.textContent = op;
          if (e.condition === op) opt.selected = true;
          cond.appendChild(opt);
        });
        cond.addEventListener("change", () => this._updateEntity(idx, "condition", cond.value));
        row.appendChild(cond);

        const val = document.createElement("input");
        val.type = "text";
        val.value = e.value ?? "";
        val.placeholder = "value";
        val.style.cssText = `width:${VALUE_WIDTH};min-width:${VALUE_WIDTH};flex:0 0 ${VALUE_WIDTH};`;
        val.addEventListener("change", () => this._updateEntity(idx, "value", val.value));
        row.appendChild(val);
      }

      // Graph color – fixed width
      if (mode === "graph") {
        const color = document.createElement("input");
        color.type = "color";
        color.value = e.color || "#4caf50";
        color.title = "Series color";
        color.style.cssText = `width:${COLOR_WIDTH};min-width:${COLOR_WIDTH};height:32px;padding:2px;flex:0 0 ${COLOR_WIDTH};cursor:pointer;`;
        color.addEventListener("change", () => this._updateEntity(idx, "color", color.value));
        row.appendChild(color);
      }

      // Remove button – fixed width
      const btn = document.createElement("button");
      btn.className = "danger";
      btn.textContent = "✕";
      btn.disabled = entities.length <= 1;
      btn.style.cssText = `width:${BTN_WIDTH};min-width:${BTN_WIDTH};flex:0 0 ${BTN_WIDTH};padding:6px 0;`;
      btn.addEventListener("click", () => this._removeEntity(idx));
      row.appendChild(btn);

      container.appendChild(row);
    });
  }
}

customElements.define("ace-indicator-editor", AceIndicatorEditor);

/* ------------------------------------------------------------------ */
/*  Registration                                                      */
/* ------------------------------------------------------------------ */
window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD_NAME,
  name: "ACE Indicator",
  description: "ACE (All Cards Engine) — compact multi-mode indicator: Display, Thresholds, Boolean, Graph.",
  preview: true,
  documentationURL: "https://github.com/",
});

console.info(
  `%c ACE-INDICATOR %c v${CARD_VERSION} `,
  "color:white;background:#4caf50;font-weight:bold",
  "color:#4caf50;background:white;font-weight:bold"
);
