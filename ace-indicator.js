/**
 * ACE Indicator — All Cards Engine
 * Custom Home Assistant Lovelace card
 * File: /config/www/ace-indicator/ace-indicator.js
 * Resource: /local/ace-indicator/ace-indicator.js  (or HACS path)
 *
 * Modes: display | thresholds | boolean | graph | notes | solar
 * Themes: default | outline | soft | minimal
 *
 * Notes mode (v1.7): multi-tab task lists (Grocery / Laundry / Car / Bills…)
 * with date-added + “Xd ago”, localStorage persistence, full theme support.
 * decimals (v1.7.1): 0–8 or empty = full precision (all modes + graph Y-axis).
 * Solar mode (v1.8.0): multi-source production, house, grid, optional batteries +
 * animated power-flow diagram + numerical tiles + optional history graph.
 * Notes tabs fix (v1.8.2): merge config tab structure with localStorage notes.
 * Layout tip (v1.8.3–1.8.5): mode-specific dismissible guidance + Precise mode.
 */

const CARD_VERSION = "1.8.5";
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
  "mdi:checkbox-marked-outline",
  "mdi:note-text",
  "mdi:cart",
  "mdi:clipboard-list",
  "mdi:format-list-checks",
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
    // ----- These two values are required for the logo to appear in the grid -----
    mode: "display",
    name: "ACE – All Cards Engine",
    // ---------------------------------------------------------------------------

    icon: "mdi:cards",
    theme: "soft",
    height: 120,
    width: 280,
    display_color: "#4caf50",
    show_value: true,
    decimals: null,

    // Better sample entity (still almost always present)
    entities: [{ entity: "sun.sun" }],

    // Thresholds defaults (so the mode doesn’t say “no data”)
    thresholds: [
      { max: 20, color: "#f44336", label: "Low" },
      { max: 50, color: "#ff9800", label: "Med" },
      { max: 100, color: "#4caf50", label: "OK" },
    ],

    // Boolean defaults
    logic: "or",
    true_color: "#4caf50",
    true_label: "On",
    false_color: "#9e9e9e",
    false_label: "Off",

    // Graph defaults
    hours_to_show: 24,
    graph_type: "sparkline",
    time_format: "24h",

    // Notes sample (keeps looking good)
    tabs: [
      {
        id: "grocery",
        name: "Grocery",
        icon: "mdi:cart",
        notes: [
          { id: "1", text: "Milk", completed: false, added: Date.now() - 3 * 86400000 },
          { id: "2", text: "Eggs", completed: false, added: Date.now() - 86400000 },
        ],
      },
      {
        id: "errands",
        name: "Errands",
        icon: "mdi:run",
        notes: [
          { id: "3", text: "Drop off dry cleaning", completed: false, added: Date.now() },
        ],
      },
    ],
    active_tab: "grocery",
    show_completed: true,
    show_dates: true,

    // Keep the private flag for the logo
    _preview: true,
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
      decimals: null,          // null / empty = full precision; 0–8 = fixed places
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
      notes: [],          // legacy single-list (migrated to tabs)
      tabs: [],
      active_tab: null,
      show_completed: true,
      show_dates: true,
      // Solar mode
      solar_entities: [],
      house_entities: [],
      grid_entity: null,
      grid_import_entity: null,
      grid_export_entity: null,
      battery_entities: [],
      show_graph: true,
      power_unit: "auto",   // auto | W | kW
      ...config,
      entities, // override with normalized list
    };

    // ---- Notes / Tabs normalization + migration from old single-list format ----
    this._normalizeNotesConfig();
    this._normalizeSolarConfig();

    // Force single entity in display mode
    if (this._config.mode === "display" && this._config.entities.length > 1) {
      this._config.entities = [this._config.entities[0]];
    }

    // Solar needs more vertical room for tiles + flow diagram
    if (this._config.mode === "solar") {
      if (!this._config.height || this._config.height < 200) {
        this._config.height = 280;
      }
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
      if (!this._config) {
        this._render();
        return;
      }

      // Notes / Solar modes do not require the generic entities list
      if (this._config.mode === "notes" || this._config.mode === "solar") {
        this._render();
        return;
      }

      if (!this._config.entities?.length) {
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
    if (this._config?.mode === "notes") {
      const active = (this._config.tabs || []).find((t) => t.id === this._config.active_tab)
        || (this._config.tabs || [])[0];
      const n = (active?.notes || []).length;
      // Base + tabs row + ~0.35 rows per item
      return Math.max(3, Math.ceil(h / 50) + Math.ceil(n * 0.35));
    }
    if (this._config?.mode === "solar") {
      // Solar flow + tiles + optional graph needs more vertical space
      return Math.max(4, Math.ceil(h / 50));
    }
    // ~50px per masonry row is a reasonable unit
    return Math.max(1, Math.ceil(h / 50));
  }

  /* -------------------- Rendering -------------------- */
  _render() {
    if (!this.shadowRoot) return;


    // Show the advertisement image ONLY for the pure stub that the
    // “By card” grid uses. As soon as the user changes anything in the
    // editor (especially the Mode), the real card layout appears.
    if (
      this._config?._preview &&
      this._config.mode === "display" &&
      this._config.name === "ACE – All Cards Engine"
    ) {
      this.shadowRoot.innerHTML = `
        <ha-card style="
          overflow: hidden;
          border-radius: 12px;
          margin: 0;
          box-shadow: none;
          background: transparent;
          height: 100%;
        ">
          <img
            src="https://raw.githubusercontent.com/imnee17001/tdmaddon/main/All%20Cards%20Engine.jpg"
            alt="ACE – All Cards Engine"
            style="
              width: 100%;
              height: 100%;
              display: block;
              object-fit: cover;
            "
          />
        </ha-card>
      `;
      return;
    }



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

      if (cfg.mode === "notes") {
        statusColor = cfg.display_color || "#4caf50";
        statusLabel = cfg.name || "Notes";
        statusValue = "";
        // Load notes from localStorage if available (overrides config seed after first use)
        this._loadNotesFromStorage();
      } else if (cfg.mode === "solar") {
        statusColor = cfg.display_color || "#4caf50";
        statusLabel = cfg.name || "Solar";
        statusValue = "";
      } else if (cfg.entities?.length && this._hass) {
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

      // Notes mode uses a different layout (vertical list)
      const isNotes = cfg.mode === "notes";
      const isSolar = cfg.mode === "solar";
      const isGraph = cfg.mode === "graph";

      this.shadowRoot.innerHTML = `
        <style>
          :host {
            display: block;
            width: ${isGraph || isNotes || isSolar ? "100%" : width + "px"};
            max-width: 100%;
            height: auto;
            box-sizing: border-box;
          }
          .indicator {
            display: flex;
            align-items: ${isNotes ? "stretch" : "center"};
            gap: 8px;
            width: 100%;
            box-sizing: border-box;
            ${isGraph
              ? `min-height: ${height}px; height: auto; padding: 10px 12px; justify-content: flex-start;`
              : isNotes || isSolar
              ? `min-height: ${height}px; height: auto; padding: 10px 12px; flex-direction: column; justify-content: flex-start;`
              : `height: ${height}px; padding: 0 12px; justify-content: ${
                  (cfg.align || "center") === "left" ? "flex-start" :
                  (cfg.align || "center") === "right" ? "flex-end" : "center"
                };`}
            border-radius: 6px;
            font-family: var(--ha-font-family-body, Roboto, sans-serif);
            font-size: 13px;
            font-weight: 500;
            white-space: ${isGraph || isNotes || isSolar ? "normal" : "nowrap"};
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
          /* Notes mode styles */
          .notes-header {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
            margin-bottom: 6px;
            flex-shrink: 0;
          }
          .notes-tabs {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            width: 100%;
            padding-bottom: 4px;
            margin-bottom: 4px;
            flex-shrink: 0;
          }
          .notes-tab {
            display: inline-flex;
            align-items: center;
            padding: 4px 10px;
            border: 1px solid rgba(128,128,128,0.35);
            border-radius: 14px;
            background: transparent;
            color: inherit;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            white-space: nowrap;
            opacity: 0.75;
            transition: all 0.15s;
          }
          .notes-tab:hover { opacity: 1; }
          .notes-tab.active {
            opacity: 1;
            background: ${statusColor};
            border-color: ${statusColor};
            color: #fff;
            font-weight: 600;
          }
          .notes-tab .tab-count {
            margin-left: 5px;
            font-size: 10px;
            background: rgba(0,0,0,0.18);
            border-radius: 8px;
            padding: 1px 5px;
          }
          .notes-tab.active .tab-count {
            background: rgba(255,255,255,0.25);
          }
          .notes-list {
            list-style: none;
            margin: 0;
            padding: 0;
            width: 100%;
            max-height: ${Math.max(80, height - 110)}px;
            overflow-y: auto;
            flex: 1;
          }
          .notes-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 5px 0;
            border-bottom: 1px solid rgba(128,128,128,0.15);
            font-size: ${Math.max(11, Number(cfg.value_size) || 13)}px;
          }
          .notes-item:last-child { border-bottom: none; }
          .notes-item.completed .notes-text {
            text-decoration: line-through;
            opacity: 0.55;
          }
          .notes-item input[type="checkbox"] {
            width: 16px;
            height: 16px;
            accent-color: ${statusColor};
            cursor: pointer;
            flex-shrink: 0;
          }
          .notes-text {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            ${styles.text}
          }
          .notes-date {
            font-size: 10px;
            opacity: 0.55;
            white-space: nowrap;
            flex-shrink: 0;
            ${styles.text}
          }
          .notes-delete {
            background: transparent;
            border: none;
            color: inherit;
            opacity: 0.45;
            cursor: pointer;
            padding: 2px 4px;
            font-size: 14px;
            line-height: 1;
            border-radius: 3px;
          }
          .notes-delete:hover { opacity: 1; background: rgba(244,67,54,0.15); }
          .notes-add-row {
            display: flex;
            gap: 6px;
            margin-top: 8px;
            width: 100%;
            flex-shrink: 0;
          }
          .notes-add-row input {
            flex: 1;
            padding: 6px 8px;
            border: 1px solid rgba(128,128,128,0.35);
            border-radius: 4px;
            background: transparent;
            color: inherit;
            font-size: 13px;
            outline: none;
          }
          .notes-add-row input::placeholder { opacity: 0.5; }
          .notes-add-row button {
            padding: 6px 10px;
            border: none;
            border-radius: 4px;
            background: ${statusColor};
            color: #fff;
            font-size: 12px;
            cursor: pointer;
            font-weight: 600;
          }
          .notes-footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 6px;
            font-size: 11px;
            opacity: 0.7;
            width: 100%;
          }
          .notes-footer button {
            background: transparent;
            border: none;
            color: inherit;
            cursor: pointer;
            text-decoration: underline;
            font-size: 11px;
            padding: 0;
          }
        </style>
        <div class="indicator">
          ${isNotes
            ? this._renderNotesShell(statusColor, statusLabel, icon)
            : isSolar
            ? this._renderSolarShell(statusColor, statusLabel, icon, height)
            : isGraph
            ? this._renderGraphShell(statusColor, statusLabel, statusValue, icon, height, width)
            : this._renderSimple(statusColor, statusLabel, statusValue, icon)}
        </div>
      `;

      if (isGraph) {
        this._canvas = this.shadowRoot.querySelector("canvas");
        if (this._canvas && this._historyCache?.ready) {
          requestAnimationFrame(() => this._drawSparkline());
        }
      }

      if (isNotes) {
        this._attachNotesListeners();
      }
      if (isSolar) {
        this._startSolarAnimation();
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

  /* -------------------- Notes mode (multi-tab + dates) -------------------- */
  _getNotesStorageKey() {
    const name = (this._config.name || "default").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    return `ace-indicator-notes-v2-${name}`;
  }

  _normalizeNotesConfig() {
    // Migrate legacy single `notes` array → tabs
    if ((!this._config.tabs || this._config.tabs.length === 0) && Array.isArray(this._config.notes) && this._config.notes.length) {
      this._config.tabs = [{
        id: "default",
        name: this._config.name || "Tasks",
        icon: this._config.icon || "mdi:checkbox-marked-outline",
        notes: this._config.notes,
      }];
      this._config.active_tab = "default";
    }

    if (!Array.isArray(this._config.tabs)) this._config.tabs = [];

    // Ensure every tab has proper structure + every note has added timestamp
    this._config.tabs = this._config.tabs.map((tab, ti) => {
      const id = tab.id || `tab-${ti}-${Date.now()}`;
      const notes = (Array.isArray(tab.notes) ? tab.notes : []).map((n, i) => {
        if (typeof n === "string") {
          return { id: `n${Date.now()}-${i}`, text: n, completed: false, added: Date.now() };
        }
        return {
          id: n.id || `n${Date.now()}-${i}`,
          text: n.text || "",
          completed: !!n.completed,
          added: n.added || Date.now(),
        };
      }).filter((n) => n.text);
      return {
        id,
        name: tab.name || `List ${ti + 1}`,
        icon: tab.icon || null,
        notes,
      };
    });

    // Ensure we always have at least one tab
    if (this._config.tabs.length === 0) {
      this._config.tabs = [{
        id: "default",
        name: "Tasks",
        icon: "mdi:checkbox-marked-outline",
        notes: [],
      }];
    }

    // Validate / set active_tab
    const ids = this._config.tabs.map((t) => t.id);
    if (!this._config.active_tab || !ids.includes(this._config.active_tab)) {
      this._config.active_tab = this._config.tabs[0].id;
    }
  }

  _loadNotesFromStorage() {
    try {
      const key = this._getNotesStorageKey();
      const raw = localStorage.getItem(key);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.tabs)) return;

      // Config (editor / YAML) is the source of truth for which tabs exist,
      // their names, icons and order.  localStorage only supplies the
      // mutable notes content for tabs that already have an id match.
      // This prevents newly-added tabs from the visual editor from being
      // discarded on every render (the previous unconditional overwrite).
      const configTabs = Array.isArray(this._config.tabs) ? this._config.tabs : [];
      const storedById = {};
      for (const t of parsed.tabs) {
        if (t && t.id) storedById[t.id] = t;
      }

      const merged = configTabs.map((cfgTab) => {
        const stored = storedById[cfgTab.id];
        if (stored && Array.isArray(stored.notes)) {
          return {
            id: cfgTab.id,
            name: cfgTab.name || stored.name || "Tasks",
            icon: cfgTab.icon != null ? cfgTab.icon : (stored.icon || null),
            notes: stored.notes,
          };
        }
        // New tab that only exists in the current config → keep its notes (seed or empty)
        return {
          id: cfgTab.id,
          name: cfgTab.name || "Tasks",
          icon: cfgTab.icon || null,
          notes: Array.isArray(cfgTab.notes) ? cfgTab.notes : [],
        };
      });

      this._config.tabs = merged;

      // Restore last active tab if it still exists
      const ids = new Set(merged.map((t) => t.id));
      if (parsed.active_tab && ids.has(parsed.active_tab)) {
        this._config.active_tab = parsed.active_tab;
      } else if (!ids.has(this._config.active_tab)) {
        this._config.active_tab = merged[0]?.id || null;
      }

      this._normalizeNotesConfig();

      // Persist the merged structure so storage stays in sync with the editor
      this._saveNotesToStorage();
    } catch (e) {
      console.warn("ACE Indicator: notes localStorage load failed", e);
    }
  }

  _saveNotesToStorage() {
    try {
      const key = this._getNotesStorageKey();
      const payload = {
        tabs: this._config.tabs || [],
        active_tab: this._config.active_tab,
      };
      localStorage.setItem(key, JSON.stringify(payload));
    } catch (e) {
      console.warn("ACE Indicator: notes localStorage save failed", e);
    }
  }

  _getActiveTab() {
    const tabs = this._config.tabs || [];
    return tabs.find((t) => t.id === this._config.active_tab) || tabs[0] || { id: "default", name: "Tasks", notes: [] };
  }

  _formatDaysSince(ts) {
    if (!ts) return "";
    const days = Math.floor((Date.now() - Number(ts)) / 86400000);
    if (days <= 0) return "today";
    if (days === 1) return "1d ago";
    if (days < 30) return `${days}d ago`;
    if (days < 60) return "1mo ago";
    return `${Math.floor(days / 30)}mo ago`;
  }

  _formatShortDate(ts) {
    if (!ts) return "";
    try {
      const d = new Date(Number(ts));
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch {
      return "";
    }
  }

  _renderNotesShell(statusColor, statusLabel, icon) {
    const tabs = this._config.tabs || [];
    const active = this._getActiveTab();
    const notes = active.notes || [];
    const showCompleted = this._config.show_completed !== false;
    const showDates = this._config.show_dates !== false;
    const visible = showCompleted ? notes : notes.filter((n) => !n.completed);
    const completedCount = notes.filter((n) => n.completed).length;

    // Tab bar
    const tabsHtml = tabs.map((t) => {
      const isActive = t.id === active.id;
      const count = (t.notes || []).filter((n) => !n.completed).length;
      return `
        <button class="notes-tab ${isActive ? "active" : ""}" data-action="switch-tab" data-tab="${t.id}">
          ${t.icon ? `<ha-icon icon="${t.icon}" style="--mdc-icon-size:14px;margin-right:4px;"></ha-icon>` : ""}
          ${this._escapeHtml(t.name)}
          ${count ? `<span class="tab-count">${count}</span>` : ""}
        </button>`;
    }).join("");

    const itemsHtml = visible
      .map((n) => {
        const days = showDates ? this._formatDaysSince(n.added) : "";
        const dateStr = showDates ? this._formatShortDate(n.added) : "";
        const dateTitle = dateStr ? `Added ${dateStr}` : "";
        return `
      <li class="notes-item ${n.completed ? "completed" : ""}" data-id="${n.id}">
        <input type="checkbox" ${n.completed ? "checked" : ""} data-action="toggle" data-id="${n.id}">
        <span class="notes-text">${this._escapeHtml(n.text)}</span>
        ${showDates && days ? `<span class="notes-date" title="${dateTitle}">${days}</span>` : ""}
        <button class="notes-delete" data-action="delete" data-id="${n.id}" title="Delete">✕</button>
      </li>`;
      })
      .join("");

    return `
      <div class="notes-header">
        ${icon ? `<div class="icon"><ha-icon icon="${icon}"></ha-icon></div>` : ""}
        <div class="text" style="text-align:left;">
          ${statusLabel ? `<div class="name">${this._escapeHtml(statusLabel)}</div>` : ""}
        </div>
      </div>

      ${tabs.length > 1 ? `<div class="notes-tabs">${tabsHtml}</div>` : ""}

      <ul class="notes-list">
        ${itemsHtml || `<li class="notes-item" style="opacity:0.6;font-style:italic;">No tasks in this list yet</li>`}
      </ul>

      <div class="notes-add-row">
        <input type="text" id="notes-new-input" placeholder="Add to ${this._escapeHtml(active.name)}…" autocomplete="off">
        <button id="notes-add-btn">Add</button>
      </div>

      <div class="notes-footer">
        <span>${notes.length} total${completedCount ? ` · ${completedCount} done` : ""}</span>
        ${completedCount ? `<button id="notes-clear-btn">Clear completed</button>` : ""}
      </div>
    `;
  }

  _escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  _updateActiveTabNotes(mutator) {
    const tabs = [...(this._config.tabs || [])];
    const idx = tabs.findIndex((t) => t.id === this._config.active_tab);
    if (idx < 0) return;
    const tab = { ...tabs[idx] };
    tab.notes = mutator([...(tab.notes || [])]);
    tabs[idx] = tab;
    this._config.tabs = tabs;
    this._saveNotesToStorage();
    this._render();
  }

  _attachNotesListeners() {
    const root = this.shadowRoot;
    if (!root) return;

    // Tab switching
    root.querySelectorAll('[data-action="switch-tab"]').forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const tabId = btn.dataset.tab;
        if (tabId && tabId !== this._config.active_tab) {
          this._config.active_tab = tabId;
          this._saveNotesToStorage();
          this._render();
        }
      });
    });

    // Toggle / Delete via event delegation on the list
    root.querySelector(".notes-list")?.addEventListener("click", (e) => {
      const target = e.target.closest("[data-action]");
      if (!target) return;
      const action = target.dataset.action;
      const id = target.dataset.id;
      if (!action || !id) return;

      if (action === "toggle") {
        this._updateActiveTabNotes((notes) => {
          const idx = notes.findIndex((n) => n.id === id);
          if (idx >= 0) notes[idx] = { ...notes[idx], completed: !notes[idx].completed };
          return notes;
        });
      } else if (action === "delete") {
        this._updateActiveTabNotes((notes) => notes.filter((n) => n.id !== id));
      }
    });

    // Checkbox change (backup)
    root.querySelectorAll('input[type="checkbox"][data-action="toggle"]').forEach((cb) => {
      cb.addEventListener("change", (e) => {
        const id = e.target.dataset.id;
        this._updateActiveTabNotes((notes) => {
          const idx = notes.findIndex((n) => n.id === id);
          if (idx >= 0) notes[idx] = { ...notes[idx], completed: e.target.checked };
          return notes;
        });
      });
    });

    // Add new task
    const input = root.getElementById("notes-new-input");
    const addBtn = root.getElementById("notes-add-btn");
    const doAdd = () => {
      const text = (input?.value || "").trim();
      if (!text) return;
      this._updateActiveTabNotes((notes) => {
        notes.push({
          id: `n${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          text,
          completed: false,
          added: Date.now(),
        });
        return notes;
      });
      if (input) input.value = "";
      requestAnimationFrame(() => {
        this.shadowRoot?.getElementById("notes-new-input")?.focus();
      });
    };
    addBtn?.addEventListener("click", doAdd);
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        doAdd();
      }
    });

    // Clear completed on active tab
    root.getElementById("notes-clear-btn")?.addEventListener("click", () => {
      this._updateActiveTabNotes((notes) => notes.filter((n) => !n.completed));
    });
  }


  /* -------------------- Solar mode -------------------- */
  _normalizeSolarConfig() {
    const toList = (v) => {
      if (!v) return [];
      if (Array.isArray(v)) {
        return v.map((e) => (typeof e === "string" ? e : (e?.entity || e?.entity_id || ""))).filter(Boolean);
      }
      if (typeof v === "string") return [v];
      return [];
    };
    this._config.solar_entities = toList(this._config.solar_entities || this._config.solar_entity);
    this._config.house_entities = toList(this._config.house_entities || this._config.house_entity);

    let bats = this._config.battery_entities || this._config.battery_entity || [];
    if (!Array.isArray(bats)) bats = bats ? [bats] : [];
    this._config.battery_entities = bats.map((b) => {
      if (typeof b === "string") return { entity: b };
      return { entity: b.entity || b.entity_id || "", soc: b.soc || b.soc_entity || null };
    }).filter((b) => b.entity);
  }

  _solarGetPower(entityId) {
    if (!entityId || !this._hass?.states[entityId]) return null;
    const n = Number(this._hass.states[entityId].state);
    return isNaN(n) ? null : n;
  }

  _solarSum(entities) {
    let total = 0, any = false;
    for (const id of entities || []) {
      const v = this._solarGetPower(id);
      if (v !== null) { total += v; any = true; }
    }
    return any ? total : null;
  }

  _solarCompute() {
    const solar = this._solarSum(this._config.solar_entities);
    const house = this._solarSum(this._config.house_entities);

    let grid = null;
    if (this._config.grid_entity) {
      grid = this._solarGetPower(this._config.grid_entity);
    } else if (this._config.grid_import_entity || this._config.grid_export_entity) {
      const imp = this._solarGetPower(this._config.grid_import_entity) || 0;
      const exp = this._solarGetPower(this._config.grid_export_entity) || 0;
      grid = imp - exp;
    }

    const batteries = (this._config.battery_entities || []).map((b) => {
      const power = this._solarGetPower(b.entity);
      let soc = null;
      if (b.soc) {
        const sv = this._solarGetPower(b.soc);
        if (sv !== null) soc = sv;
      }
      return { entity: b.entity, power, soc };
    });
    const hasBattery = batteries.length > 0;
    let batteryNet = null;
    if (hasBattery) {
      batteryNet = batteries.reduce((sum, b) => sum + (b.power || 0), 0);
    }

    let unit = this._config.power_unit || "auto";
    const sample = [solar, house, grid, batteryNet].find((v) => v !== null && v !== undefined);
    if (unit === "auto") {
      unit = (sample !== undefined && Math.abs(sample) >= 1000) ? "kW" : "W";
    }
    const scale = unit === "kW" ? 0.001 : 1;

    const fmt = (v) => {
      if (v === null || v === undefined) return "—";
      return this._formatNumber(v * scale) + " " + unit;
    };

    const importing = grid !== null && grid > 0;
    const exporting = grid !== null && grid < 0;

    return {
      solar, house, grid, batteryNet, batteries, hasBattery, unit, scale, fmt,
      solarDisp: fmt(solar),
      houseDisp: fmt(house),
      gridDisp: grid === null ? "—" : ((importing ? "↓ " : exporting ? "↑ " : "") + fmt(Math.abs(grid))),
      importing, exporting,
      batteryDisp: batteryNet === null ? "—" : ((batteryNet > 0 ? "↑ " : batteryNet < 0 ? "↓ " : "") + fmt(Math.abs(batteryNet))),
      batteryCharging: batteryNet !== null && batteryNet > 0,
      batteryDischarging: batteryNet !== null && batteryNet < 0,
    };
  }

  _renderSolarShell(statusColor, statusLabel, icon, height) {
    const data = this._solarCompute();
    const showGraph = this._config.show_graph !== false;
    const flowH = showGraph ? Math.max(120, Math.min(180, (height || 220) * 0.45)) : Math.max(140, (height || 220) - 80);

    const tiles = [
      { label: "Solar", value: data.solarDisp, color: "#f9a825", icon: "mdi:solar-power" },
      { label: "House", value: data.houseDisp, color: "#42a5f5", icon: "mdi:home" },
      { label: "Grid", value: data.gridDisp, color: data.importing ? "#ef5350" : "#66bb6a", icon: "mdi:transmission-tower" },
    ];
    if (data.hasBattery) {
      tiles.push({
        label: "Battery",
        value: data.batteryDisp,
        color: data.batteryCharging ? "#ab47bc" : "#7e57c2",
        icon: "mdi:battery",
      });
    }

    const tilesHtml = tiles.map((t) => `
      <div class="solar-tile">
        <div class="solar-tile-icon" style="color:${t.color}"><ha-icon icon="${t.icon}"></ha-icon></div>
        <div class="solar-tile-label">${t.label}</div>
        <div class="solar-tile-value">${t.value}</div>
      </div>`).join("");

    const solarP = Math.max(0, data.solar || 0);
    const importing = data.importing;
    const exporting = data.exporting;
    const batP = data.batteryNet || 0;
    const hasBat = data.hasBattery;

    // Compact numbers for node labels
    const short = (disp) => (disp || "—").replace(/ (W|kW)$/, "");

    const svg = `
      <svg class="solar-flow-svg" viewBox="0 0 320 170" preserveAspectRatio="xMidYMid meet">
        <defs>
          <marker id="arrO" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#f9a825"/></marker>
          <marker id="arrG" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#66bb6a"/></marker>
          <marker id="arrR" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#ef5350"/></marker>
          <marker id="arrP" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#ab47bc"/></marker>
        </defs>

        <!-- Solar node -->
        <g transform="translate(60,36)">
          <circle r="24" fill="#fff8e1" stroke="#f9a825" stroke-width="2.5"/>
          <text text-anchor="middle" dy="-30" font-size="11" fill="currentColor">Solar</text>
          <text text-anchor="middle" dy="5" font-size="12" font-weight="700" fill="#f9a825">${short(data.solarDisp)}</text>
        </g>
        <!-- House node -->
        <g transform="translate(160,100)">
          <circle r="26" fill="#e3f2fd" stroke="#42a5f5" stroke-width="2.5"/>
          <text text-anchor="middle" dy="-32" font-size="11" fill="currentColor">House</text>
          <text text-anchor="middle" dy="5" font-size="12" font-weight="700" fill="#42a5f5">${short(data.houseDisp)}</text>
        </g>
        <!-- Grid node -->
        <g transform="translate(260,36)">
          <circle r="24" fill="${importing ? "#ffebee" : "#e8f5e9"}" stroke="${importing ? "#ef5350" : "#66bb6a"}" stroke-width="2.5"/>
          <text text-anchor="middle" dy="-30" font-size="11" fill="currentColor">Grid</text>
          <text text-anchor="middle" dy="5" font-size="12" font-weight="700" fill="${importing ? "#ef5350" : "#66bb6a"}">${data.grid === null ? "—" : short(data.gridDisp)}</text>
        </g>
        ${hasBat ? `
        <g transform="translate(160,155)">
          <circle r="20" fill="#f3e5f5" stroke="#ab47bc" stroke-width="2.5"/>
          <text text-anchor="middle" dy="-26" font-size="11" fill="currentColor">Battery</text>
          <text text-anchor="middle" dy="4" font-size="11" font-weight="700" fill="#ab47bc">${short(data.batteryDisp)}</text>
        </g>` : ""}

        <!-- Static flow lines -->
        <path d="M84,45 Q120,70 140,90" fill="none" stroke="#f9a825" stroke-width="2.5" stroke-opacity="0.4" marker-end="url(#arrO)"/>
        <path d="M84,36 Q160,12 236,36" fill="none" stroke="#66bb6a" stroke-width="2.5" stroke-opacity="${exporting ? 0.55 : 0.12}" marker-end="url(#arrG)"/>
        <path d="M236,45 Q200,70 180,90" fill="none" stroke="#ef5350" stroke-width="2.5" stroke-opacity="${importing ? 0.55 : 0.12}" marker-end="url(#arrR)"/>
        ${hasBat ? `<path d="M160,126 L160,135" fill="none" stroke="#ab47bc" stroke-width="2.5" stroke-opacity="0.45" marker-end="url(#arrP)"/>` : ""}

        <!-- Animated particles -->
        ${solarP > 5 ? `<circle r="3.5" fill="#f9a825"><animateMotion dur="${solarP > 2000 ? "1.6s" : "2.8s"}" repeatCount="indefinite" path="M84,45 Q120,70 140,90"/></circle>` : ""}
        ${exporting && Math.abs(data.grid||0) > 10 ? `<circle r="3" fill="#66bb6a"><animateMotion dur="2.1s" repeatCount="indefinite" path="M84,36 Q160,12 236,36"/></circle>` : ""}
        ${importing && Math.abs(data.grid||0) > 10 ? `<circle r="3" fill="#ef5350"><animateMotion dur="2.1s" repeatCount="indefinite" path="M236,45 Q200,70 180,90"/></circle>` : ""}
        ${hasBat && Math.abs(batP) > 10 ? `<circle r="3" fill="#ab47bc"><animateMotion dur="1.9s" repeatCount="indefinite" path="${batP > 0 ? "M160,126 L160,135" : "M160,135 L160,126"}"/></circle>` : ""}
      </svg>`;

    return `
      <style>
        .solar-wrap { width:100%; display:flex; flex-direction:column; gap:8px; color:inherit; }
        .solar-header { display:flex; align-items:center; gap:8px; }
        .solar-tiles { display:flex; flex-wrap:wrap; gap:6px; }
        .solar-tile {
          flex:1; min-width:68px; text-align:center;
          background:rgba(128,128,128,0.08); border-radius:8px; padding:6px 3px;
        }
        .solar-tile-icon { --mdc-icon-size:17px; margin-bottom:1px; }
        .solar-tile-label { font-size:10px; opacity:0.7; }
        .solar-tile-value { font-size:12px; font-weight:600; margin-top:1px; white-space:nowrap; }
        .solar-flow-svg { width:100%; height:${flowH}px; display:block; }
        .solar-flow-svg text { fill:currentColor; font-family:var(--ha-font-family-body, Roboto, sans-serif); }
      </style>
      <div class="solar-wrap">
        <div class="solar-header">
          ${icon ? `<div class="icon"><ha-icon icon="${icon}"></ha-icon></div>` : ""}
          <div class="text" style="text-align:left;">
            ${statusLabel ? `<div class="name">${this._escapeHtml(statusLabel)}</div>` : ""}
          </div>
        </div>
        <div class="solar-tiles">${tilesHtml}</div>
        <div class="solar-flow">${svg}</div>
      </div>
    `;
  }

  _startSolarAnimation() {
    // SMIL animateMotion is used; nothing extra required for v1.
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

  // Format a numeric value according to the decimals option, then attach unit.
  // decimals: null/undefined/"" → full precision; 0–8 → fixed decimal places.
  _formatNumber(val) {
    if (val === null || val === undefined || val === "") return "";
    const n = Number(val);
    if (isNaN(n)) return String(val);

    const d = this._config?.decimals;
    if (d === null || d === undefined || d === "") {
      // Full precision – strip trailing zeros after the decimal for cleaner display
      return String(n);
    }
    const places = Math.max(0, Math.min(8, Number(d)));
    return n.toFixed(places);
  }

  // Currency / prefix-style units go before the number; everything else after.
  _formatValueWithUnit(val, unit) {
    const formatted = this._formatNumber(val);
    if (!unit) return formatted;
    const u = String(unit).trim();
    const PREFIX_UNITS = ["$", "€", "£", "¥", "₹", "₩", "₽", "₪", "₱", "฿", "₫", "₴", "₦", "₡", "R$", "A$", "C$", "HK$", "NZ$", "US$"];
    if (PREFIX_UNITS.includes(u) || /^[A-Z]{0,3}\$$/.test(u)) {
      return `${u}${formatted}`;
    }
    return `${formatted} ${u}`;
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
        // y label – respect the decimals option when set, otherwise smart default
        let label;
        const d = this._config?.decimals;
        if (d !== null && d !== undefined && d !== "") {
          label = val.toFixed(Math.max(0, Math.min(8, Number(d))));
        } else {
          label = Math.abs(val) >= 100 ? val.toFixed(0) : val.toFixed(1);
        }
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
    // Solar needs more vertical room
    if (key === "mode" && value === "solar" && (!newCfg.height || newCfg.height < 200)) {
      newCfg.height = 280;
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

  /* -------------------- Layout tip (dismissible, mode-specific) -------------------- */
  _isLayoutTipHidden() {
    try {
      return localStorage.getItem("ace-indicator-hide-layout-tip") === "1";
    } catch {
      return false;
    }
  }

  _hideLayoutTip() {
    try {
      localStorage.setItem("ace-indicator-hide-layout-tip", "1");
    } catch {
      /* ignore */
    }
    this._render();
  }

  _showLayoutTip() {
    try {
      localStorage.removeItem("ace-indicator-hide-layout-tip");
    } catch {
      /* ignore */
    }
    this._render();
  }

  /** Mode-specific layout guidance. Uses official HA term "Precise mode". */
  _getLayoutTip(mode) {
    switch (mode) {
      case "notes":
        return {
          title: "⚠️ NOTES / TASKS — NEEDS ROOM",
          body: `Give this card <strong>≈ 12–18 columns</strong> on the Layout tab.
            Tabs + the task list need horizontal space or the card becomes unusable.`,
          note: `On the Layout tab also enable <strong>Precise mode</strong> for finer column control.
            The pixel Width setting above is only a preferred size — HA’s grid columns are the real constraint.`,
        };
      case "solar":
        return {
          title: "⚠️ SOLAR / POWER FLOW — NEEDS ROOM",
          body: `Give this card <strong>≈ 16–24 columns</strong> (or full width) on the Layout tab.
            The power-flow diagram + tiles will look cramped otherwise.`,
          note: `On the Layout tab also enable <strong>Precise mode</strong> for finer column control.
            Consider a section with higher column_span if you need even more total width.`,
        };
      case "graph":
        return {
          title: "⚠️ GRAPH — FILLS SECTION WIDTH",
          body: `Graph mode stretches to the available width. Still set a sensible column span
            (<strong>≈ 8–16 columns</strong>) so it doesn’t collapse into a thin strip.`,
          note: `On the Layout tab enable <strong>Precise mode</strong> if the size still looks wrong.
            Pixel Width is ignored in graph mode — columns control the real size.`,
        };
      case "display":
      case "thresholds":
      case "boolean":
      default:
        return {
          title: "⚠️ COMPACT INDICATOR",
          body: `These modes are meant to be tight. <strong>≈ 3–6 columns</strong> is usually enough.
            Give it more only if you want a wider label or larger icon/value text.`,
          note: `If the card still shrinks unexpectedly, open the Layout tab and enable
            <strong>Precise mode</strong> for finer column steps.`,
        };
    }
  }

  _render() {
    const cfg = this._config;
    const mode = cfg.mode || "display";
    const tipHidden = this._isLayoutTipHidden();
    const tip = this._getLayoutTip(mode);

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
        .layout-tip {
          background: #fff3cd;
          border: 2px solid #e6a700;
          padding: 10px 12px;
          border-radius: 6px;
          font-size: 12px;
          margin-top: 10px;
          margin-bottom: 4px;
          color: #333;
          line-height: 1.4;
        }
        .layout-tip strong { font-weight: 700; }
        .layout-tip a { color: var(--primary-color); cursor: pointer; text-decoration: underline; }
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
            <option value="notes" ${mode === "notes" ? "selected" : ""}>Notes / Tasks</option>
            <option value="solar" ${mode === "solar" ? "selected" : ""}>Solar / Power Flow</option>
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
              <input id="height" type="number" min="24" max="480" value="${cfg.height || 36}">
            </div>
            <div>
              <label>Width (px)</label>
              <input id="width" type="number" min="60" max="400" value="${cfg.width || 140}">
            </div>
          </div>

          ${tipHidden
            ? `<div class="hint" style="margin-top:6px"><a id="show-layout-tip">Show layout tip</a></div>`
            : `<div class="layout-tip">
                <div style="font-weight:700; margin-bottom:6px;">${tip.title}</div>
                <div style="margin-bottom:6px;">${tip.body}</div>
                <div style="margin-bottom:8px; font-size:11px;">${tip.note}</div>
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-weight:500; margin:0;">
                  <input type="checkbox" id="hide-layout-tip" style="width:16px;height:16px;accent-color:var(--primary-color);">
                  Got it — don’t show this tip again
                </label>
              </div>`}

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

          <div class="row" style="margin-top:10px">
            <div style="flex:1">
              <label>Decimal places</label>
              <input id="decimals" type="number" min="0" max="8" step="1"
                     value="${cfg.decimals === null || cfg.decimals === undefined || cfg.decimals === "" ? "" : cfg.decimals}"
                     placeholder="Full precision">
              <div class="hint">Leave empty for full precision. 0–8 forces fixed places (value + graph Y-axis).</div>
            </div>
          </div>
        </div>
      </div>

      <!-- ENTITIES (hidden for notes mode) -->
      ${mode !== "notes" && mode !== "solar" ? `
      <div class="section">
        <div class="section-title">Entities ${mode === "display" ? "(max 1 in Display mode)" : ""}</div>
        <div class="frame">
          ${!(cfg.entities?.length) ? `<div class="warning">⚠ No entities defined – add at least one</div>` : ""}
          <div id="entities-container"></div>
          <button id="add-entity" class="secondary" style="margin-top:6px" ${mode === "display" && (cfg.entities || []).length >= 1 ? "disabled" : ""}>+ Add entity</button>
        </div>
      </div>
      ` : ""}

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

      ${mode === "notes" ? `
        <div class="section">
          <div class="section-title">Notes / Tasks Mode</div>
          <div class="frame">
            <div class="hint" style="margin-bottom:10px">
              Multi-tab task lists (Grocery, Laundry, Car, Bills…).<br>
              Each item tracks <strong>date added</strong> and shows “Xd ago”.<br>
              Data lives in browser localStorage keyed by the card’s Display Name.
            </div>
            <label>Accent / Theme Color</label>
            <input id="display_color" type="color" value="${cfg.display_color || "#4caf50"}">
            <div class="row" style="margin-top:10px">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;flex:1;">
                <input type="checkbox" id="show_completed" ${cfg.show_completed !== false ? "checked" : ""} style="width:16px;height:16px;accent-color:var(--primary-color);">
                Show completed
              </label>
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;flex:1;">
                <input type="checkbox" id="show_dates" ${cfg.show_dates !== false ? "checked" : ""} style="width:16px;height:16px;accent-color:var(--primary-color);">
                Show dates / days ago
              </label>
            </div>

            <div class="section-title" style="margin-top:16px;margin-bottom:6px;">Tabs / Lists</div>
            <div class="hint" style="margin-bottom:8px">Each tab is an independent list. Add the tabs you need (Grocery, Laundry, Car maintenance, etc.).</div>
            <div id="tabs-container"></div>
            <button id="add-tab" class="secondary" style="margin-top:6px">+ Add tab</button>
          </div>
        </div>
      ` : ""}

      ${mode === "solar" ? `
        <div class="section">
          <div class="section-title">Solar / Power Flow</div>
          <div class="frame">
            <div class="hint" style="margin-bottom:10px">
              Map your production, load, grid and optional battery entities.<br>
              Multiple solar entities are summed (micro-inverters + main inverter).
            </div>

            <div class="section-title" style="font-size:13px;margin-bottom:4px;">Solar production</div>
            <div id="solar-entities-container"></div>
            <button id="add-solar-entity" class="secondary" style="margin-top:4px;margin-bottom:12px">+ Add solar entity</button>

            <div class="section-title" style="font-size:13px;margin-bottom:4px;">House / load</div>
            <div id="house-entities-container"></div>
            <button id="add-house-entity" class="secondary" style="margin-top:4px;margin-bottom:12px">+ Add house entity</button>

            <div class="section-title" style="font-size:13px;margin-bottom:4px;">Grid power (signed: + import / – export)</div>
            <div id="grid-entity-container"></div>

            <div class="section-title" style="font-size:13px;margin:12px 0 4px;">Batteries (optional)</div>
            <div id="battery-entities-container"></div>
            <button id="add-battery-entity" class="secondary" style="margin-top:4px;margin-bottom:12px">+ Add battery entity</button>

            <div class="row" style="margin-top:8px">
              <div style="flex:1">
                <label>Power unit</label>
                <select id="power_unit">
                  <option value="auto" ${(cfg.power_unit || "auto") === "auto" ? "selected" : ""}>Auto</option>
                  <option value="W" ${cfg.power_unit === "W" ? "selected" : ""}>Watts (W)</option>
                  <option value="kW" ${cfg.power_unit === "kW" ? "selected" : ""}>Kilowatts (kW)</option>
                </select>
              </div>
              <div style="flex:1; display:flex; align-items:flex-end;">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                  <input type="checkbox" id="show_graph" ${cfg.show_graph !== false ? "checked" : ""} style="width:16px;height:16px;accent-color:var(--primary-color);">
                  Show history graph (future)
                </label>
              </div>
            </div>
          </div>
        </div>
      ` : ""}

    `;

    // Event listeners
    this.shadowRoot.getElementById("hide-layout-tip")?.addEventListener("change", (e) => {
      if (e.target.checked) this._hideLayoutTip();
    });
    this.shadowRoot.getElementById("show-layout-tip")?.addEventListener("click", (e) => {
      e.preventDefault();
      this._showLayoutTip();
    });

    this.shadowRoot.getElementById("mode")?.addEventListener("change", (e) => this._update("mode", e.target.value));
    this.shadowRoot.getElementById("name")?.addEventListener("change", (e) => this._update("name", e.target.value));
    this.shadowRoot.getElementById("theme")?.addEventListener("change", (e) => this._update("theme", e.target.value));
    this.shadowRoot.getElementById("align")?.addEventListener("change", (e) => this._update("align", e.target.value));
    this.shadowRoot.getElementById("height")?.addEventListener("change", (e) => {
      const v = Number(e.target.value);
      this._update("height", !v || v < 24 ? 36 : Math.min(480, v));
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
    this.shadowRoot.getElementById("decimals")?.addEventListener("change", (e) => {
      const raw = e.target.value.trim();
      if (raw === "") {
        this._update("decimals", null);
      } else {
        const v = Number(raw);
        this._update("decimals", isNaN(v) ? null : Math.max(0, Math.min(8, Math.round(v))));
      }
    });
    this.shadowRoot.getElementById("display_color")?.addEventListener("change", (e) => this._update("display_color", e.target.value));
    this.shadowRoot.getElementById("logic")?.addEventListener("change", (e) => this._update("logic", e.target.value));
    this.shadowRoot.getElementById("true_color")?.addEventListener("change", (e) => this._update("true_color", e.target.value));
    this.shadowRoot.getElementById("true_label")?.addEventListener("change", (e) => this._update("true_label", e.target.value));
    this.shadowRoot.getElementById("false_color")?.addEventListener("change", (e) => this._update("false_color", e.target.value));
    this.shadowRoot.getElementById("false_label")?.addEventListener("change", (e) => this._update("false_label", e.target.value));
    this.shadowRoot.getElementById("hours_to_show")?.addEventListener("change", (e) => this._update("hours_to_show", Number(e.target.value)));
    this.shadowRoot.getElementById("time_format")?.addEventListener("change", (e) => this._update("time_format", e.target.value));
    this.shadowRoot.getElementById("graph_type")?.addEventListener("change", (e) => this._update("graph_type", e.target.value));

    // Notes mode
    this.shadowRoot.getElementById("show_completed")?.addEventListener("change", (e) => this._update("show_completed", e.target.checked));
    this.shadowRoot.getElementById("show_dates")?.addEventListener("change", (e) => this._update("show_dates", e.target.checked));

    // Solar mode
    this.shadowRoot.getElementById("power_unit")?.addEventListener("change", (e) => {
      this._update("power_unit", e.target.value);
    });
    this.shadowRoot.getElementById("show_graph")?.addEventListener("change", (e) => {
      this._update("show_graph", e.target.checked);
    });
    if (mode === "solar") {
      this._buildSolarEntityRows();
      this.shadowRoot.getElementById("add-solar-entity")?.addEventListener("click", () => {
        const list = [...(this._config.solar_entities || []), ""];
        this._update("solar_entities", list);
      });
      this.shadowRoot.getElementById("add-house-entity")?.addEventListener("click", () => {
        const list = [...(this._config.house_entities || []), ""];
        this._update("house_entities", list);
      });
      this.shadowRoot.getElementById("add-battery-entity")?.addEventListener("click", () => {
        const list = [...(this._config.battery_entities || []), { entity: "" }];
        this._update("battery_entities", list);
      });
    }

    // Build tab rows if in notes mode
    if (mode === "notes") {
      this._buildTabRows();
      this.shadowRoot.getElementById("add-tab")?.addEventListener("click", () => {
        const tabs = [...(this._config.tabs || [])];
        const newId = `tab-${Date.now()}`;
        tabs.push({
          id: newId,
          name: `List ${tabs.length + 1}`,
          icon: "mdi:checkbox-marked-outline",
          notes: [],
        });
        this._update("tabs", tabs);
        // Also set as active if first
        if (tabs.length === 1) this._update("active_tab", newId);
      });
    }

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

  _buildTabRows() {
    const container = this.shadowRoot.getElementById("tabs-container");
    if (!container) return;
    container.innerHTML = "";

    const tabs = this._config.tabs || [];
    const ICON_CHOICES = [
      "mdi:cart", "mdi:washing-machine", "mdi:car", "mdi:cash", "mdi:home",
      "mdi:clipboard-list", "mdi:checkbox-marked-outline", "mdi:note-text",
      "mdi:broom", "mdi:tools", "mdi:pill", "mdi:run",
    ];

    tabs.forEach((tab, idx) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;";

      // Name
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.value = tab.name || "";
      nameInput.placeholder = "Tab name";
      nameInput.style.cssText = "flex:1;min-width:100px;";
      nameInput.addEventListener("change", () => {
        const updated = [...(this._config.tabs || [])];
        updated[idx] = { ...updated[idx], name: nameInput.value.trim() || `List ${idx + 1}` };
        this._update("tabs", updated);
      });
      row.appendChild(nameInput);

      // Icon select
      const iconSelect = document.createElement("select");
      iconSelect.style.cssText = "width:140px;";
      ICON_CHOICES.forEach((ic) => {
        const opt = document.createElement("option");
        opt.value = ic;
        opt.textContent = ic.replace("mdi:", "");
        if (tab.icon === ic) opt.selected = true;
        iconSelect.appendChild(opt);
      });
      // Allow custom
      const customOpt = document.createElement("option");
      customOpt.value = "__custom__";
      customOpt.textContent = "Other…";
      if (tab.icon && !ICON_CHOICES.includes(tab.icon)) customOpt.selected = true;
      iconSelect.appendChild(customOpt);

      iconSelect.addEventListener("change", () => {
        if (iconSelect.value === "__custom__") return;
        const updated = [...(this._config.tabs || [])];
        updated[idx] = { ...updated[idx], icon: iconSelect.value };
        this._update("tabs", updated);
      });
      row.appendChild(iconSelect);

      // Remove
      const btn = document.createElement("button");
      btn.className = "danger";
      btn.textContent = "✕";
      btn.disabled = tabs.length <= 1;
      btn.title = "Remove tab";
      btn.addEventListener("click", () => {
        if (tabs.length <= 1) return;
        const updated = [...(this._config.tabs || [])];
        const removedId = updated[idx].id;
        updated.splice(idx, 1);
        this._update("tabs", updated);
        if (this._config.active_tab === removedId) {
          this._update("active_tab", updated[0]?.id);
        }
      });
      row.appendChild(btn);

      container.appendChild(row);
    });
  }

  _buildSolarEntityRows() {
    const PICKER_W = "260px";
    const BTN_W = "32px";

    const makeRow = (entityId, onChange, onRemove, canRemove) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:8px;align-items:center;margin-bottom:6px;";
      const picker = document.createElement("ha-entity-picker");
      picker.hass = this._hass;
      picker.value = entityId || "";
      picker.allowCustomEntity = true;
      picker.style.cssText = `width:${PICKER_W};min-width:${PICKER_W};flex:0 0 ${PICKER_W};`;
      picker.addEventListener("value-changed", (ev) => onChange(ev.detail.value || ""));
      row.appendChild(picker);
      const btn = document.createElement("button");
      btn.className = "danger";
      btn.textContent = "✕";
      btn.disabled = !canRemove;
      btn.style.cssText = `width:${BTN_W};min-width:${BTN_W};flex:0 0 ${BTN_W};padding:6px 0;`;
      btn.addEventListener("click", onRemove);
      row.appendChild(btn);
      return row;
    };

    // Solar production list
    const solarBox = this.shadowRoot.getElementById("solar-entities-container");
    if (solarBox) {
      solarBox.innerHTML = "";
      let list = [...(this._config.solar_entities || [])];
      if (!list.length) list = [""];
      list.forEach((ent, idx) => {
        solarBox.appendChild(makeRow(
          ent,
          (val) => {
            const updated = [...(this._config.solar_entities || [])];
            // ensure length
            while (updated.length <= idx) updated.push("");
            updated[idx] = val;
            this._update("solar_entities", updated);
          },
          () => {
            const updated = [...(this._config.solar_entities || [])];
            updated.splice(idx, 1);
            this._update("solar_entities", updated);
          },
          list.length > 1
        ));
      });
    }

    // House list
    const houseBox = this.shadowRoot.getElementById("house-entities-container");
    if (houseBox) {
      houseBox.innerHTML = "";
      let list = [...(this._config.house_entities || [])];
      if (!list.length) list = [""];
      list.forEach((ent, idx) => {
        houseBox.appendChild(makeRow(
          ent,
          (val) => {
            const updated = [...(this._config.house_entities || [])];
            while (updated.length <= idx) updated.push("");
            updated[idx] = val;
            this._update("house_entities", updated);
          },
          () => {
            const updated = [...(this._config.house_entities || [])];
            updated.splice(idx, 1);
            this._update("house_entities", updated);
          },
          list.length > 1
        ));
      });
    }

    // Grid (single)
    const gridBox = this.shadowRoot.getElementById("grid-entity-container");
    if (gridBox) {
      gridBox.innerHTML = "";
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:8px;align-items:center;margin-bottom:6px;";
      const picker = document.createElement("ha-entity-picker");
      picker.hass = this._hass;
      picker.value = this._config.grid_entity || "";
      picker.allowCustomEntity = true;
      picker.style.cssText = `width:${PICKER_W};min-width:${PICKER_W};flex:0 0 ${PICKER_W};`;
      picker.addEventListener("value-changed", (ev) => {
        this._update("grid_entity", ev.detail.value || null);
      });
      row.appendChild(picker);
      gridBox.appendChild(row);
    }

    // Batteries
    const batBox = this.shadowRoot.getElementById("battery-entities-container");
    if (batBox) {
      batBox.innerHTML = "";
      const list = this._config.battery_entities || [];
      list.forEach((b, idx) => {
        const ent = typeof b === "string" ? b : (b.entity || "");
        batBox.appendChild(makeRow(
          ent,
          (val) => {
            const updated = [...(this._config.battery_entities || [])];
            updated[idx] = { entity: val };
            this._update("battery_entities", updated);
          },
          () => {
            const updated = [...(this._config.battery_entities || [])];
            updated.splice(idx, 1);
            this._update("battery_entities", updated);
          },
          true
        ));
      });
    }
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
  description: "ACE (All Cards Engine) — compact multi-mode indicator: Display, Thresholds, Boolean, Graph, Notes/Tasks, Solar.",
  preview: true,
  documentationURL: "https://github.com/imnee17001/tdmaddon",
});

console.info(
  `%c ACE-INDICATOR %c v${CARD_VERSION} `,
  "color:white;background:#4caf50;font-weight:bold",
  "color:#4caf50;background:white;font-weight:bold"
);
