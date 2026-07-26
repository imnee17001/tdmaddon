# ACE Indicator

**All Cards Engine** — a compact, multi-mode Home Assistant Lovelace card.

One card, four modes, four themes. Built for dashboards that need dense status at a glance: printers, batteries, MFA codes, prices, sensors, and history sparklines.

![ACE modes](https://img.shields.io/badge/modes-Display%20%7C%20Thresholds%20%7C%20Boolean%20%7C%20Graph-blue)
![Themes](https://img.shields.io/badge/themes-Default%20%7C%20Outline%20%7C%20Soft%20%7C%20Minimal-green)
![HACS](https://img.shields.io/badge/HACS-Custom%20Repository-orange)

---

## Features

| Mode | What it does |
|------|----------------|
| **Display** | Single entity, value + unit, custom color (simplest) |
| **Thresholds** | Lowest numeric value among entities → color/label by ordered thresholds |
| **Boolean** | Per-entity conditions with AND/OR logic, true/false colors & labels |
| **Graph** | Multi-series history sparkline with grid, legend, 12h/24h time |

**Themes:** Default (solid) · Outline · Soft (pastel) · Minimal  

Also includes:

- Configurable icon, name, alignment (left/center/right)
- Icon size, name size, value size
- Currency units (`$`, `€`, …) shown on the left
- Graph fills section width and redraws on resize
- Clean UI editor with fixed-width entity rows

---

## HACS install (custom repository)

1. Open **HACS → Frontend**
2. ⋮ menu → **Custom repositories**
3. Repository URL: `https://github.com/imnee17001/tdmaddon`
4. Category: **Lovelace**
5. **Add** → find **ACE Indicator** → **Download**
6. Restart Home Assistant (or at least clear frontend cache)
7. Add the resource if HACS did not (see below)

### Manual resource (if needed)

**Settings → Dashboards → Resources → Add resource**

| Field | Value |
|-------|--------|
| URL | `/hacsfiles/ace-indicator/ace-indicator.js` |
| Type | **JavaScript Module** |

*(Path may vary slightly by HACS version; HACS usually registers this for you.)*

---

## Manual install

1. Copy `ace-indicator.js` to:
   ```
   /config/www/ace-indicator/ace-indicator.js
   ```
2. **Settings → Dashboards → Resources → Add resource**
   - URL: `/local/ace-indicator/ace-indicator.js`
   - Type: **JavaScript Module**
3. Hard-refresh the browser (Ctrl+Shift+R)

---

## Minimal examples

### Display

```yaml
type: custom:ace-indicator
mode: display
name: Battery
icon: mdi:battery
theme: soft
entities:
  - entity: sensor.phone_battery
display_color: "#4caf50"
```

### Thresholds

```yaml
type: custom:ace-indicator
mode: thresholds
name: Toner
icon: mdi:printer
theme: outline
show_value: true
entities:
  - entity: sensor.printer_black_toner
thresholds:
  - max: 15
    color: "#f44336"
    label: Low
  - max: 40
    color: "#ff9800"
    label: Med
  - max: 100
    color: "#4caf50"
    label: OK
```

### Boolean

```yaml
type: custom:ace-indicator
mode: boolean
name: Alerts
logic: or
true_color: "#f44336"
true_label: Alert
false_color: "#4caf50"
false_label: OK
entities:
  - entity: binary_sensor.leak
    condition: "=="
    value: "on"
  - entity: binary_sensor.smoke
    condition: "=="
    value: "on"
```

### Graph

```yaml
type: custom:ace-indicator
mode: graph
name: My BTC Stash
icon: mdi:chart-line
theme: default
height: 200
hours_to_show: 24
time_format: "12h"
graph_type: sparkline
entities:
  - entity: sensor.cryptoinfo_main_btc_stash
    color: "#ff9800"
```

---

## Options (summary)

| Option | Default | Notes |
|--------|---------|--------|
| `mode` | `display` | `display` \| `thresholds` \| `boolean` \| `graph` |
| `theme` | `default` | `default` \| `outline` \| `soft` \| `minimal` |
| `align` | `center` | `left` \| `center` \| `right` |
| `name` | | Indicator display text |
| `icon` | `mdi:circle` | Use `none` to hide |
| `height` | `36` | px (graph: plot height driver) |
| `width` | `140` | px (non-graph; graph fills section) |
| `icon_size` | `18` | px |
| `name_size` | `12` | px |
| `value_size` | `14` | px |
| `show_value` | `true` | |
| `entities` | | List of `{ entity, color?, condition?, value? }` |
| `thresholds` | | List of `{ max, color, label }` |
| `hours_to_show` | `24` | Graph only |
| `time_format` | `24h` | `12h` \| `24h` |
| `graph_type` | `sparkline` | `sparkline` \| `line` |

---

## Layout tip

Graph mode **fills the section width**. Set columns in the card’s **Layout** tab so the edit overlay and size match what you want.

Non-graph modes use the configured **Width (px)**; give the card enough layout columns or it may shrink.

---

## Version

**1.5.0** — ACE rename + HACS packaging baseline.

---

## License

MIT
