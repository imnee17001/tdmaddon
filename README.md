# ACE Indicator

**All Cards Engine** — A compact, multi-mode Lovelace card for Home Assistant.

One card · Four modes · Four themes  
Built for dense status displays: printers, batteries, MFA, prices, sensors, and history sparklines.

![Modes](https://img.shields.io/badge/modes-Display%20%7C%20Thresholds%20%7C%20Boolean%20%7C%20Graph-blue)
![Themes](https://img.shields.io/badge/themes-Default%20%7C%20Outline%20%7C%20Soft%20%7C%20Minimal-green)
![HACS](https://img.shields.io/badge/HACS-Custom%20Repository-orange)

---

## Features

| Mode | Description |
|------|-------------|
| **Display** | Single entity with value + unit and custom color |
| **Thresholds** | Lowest numeric value mapped to color/label thresholds |
| **Boolean** | Per-entity conditions with AND/OR logic |
| **Graph** | Multi-series history sparkline with legend |

**Themes:** `default` · `outline` · `soft` · `minimal`

Additional features:
- Configurable icon, name, and alignment
- Adjustable icon / name / value sizes
- Currency symbol support
- Responsive graph that fills section width
- Clean visual editor

---

## Installation

### HACS (Recommended)

1. Go to **HACS → Frontend**
2. Click the three dots (⋮) → **Custom repositories**
3. Add repository:  
   `https://github.com/imnee17001/tdmaddon`
4. Category: **Lovelace**
5. Click **Add**, then find **ACE Indicator** and click **Download**
6. Restart Home Assistant (or hard-refresh the browser)

### Manual Installation

1. Download `ace-indicator.js` from this repository
2. Place it in:
/config/www/ace-indicator/ace-indicator.js
text3. Add a Lovelace resource:
- URL: `/local/ace-indicator/ace-indicator.js`
- Type: **JavaScript Module**
4. Hard-refresh your browser (`Ctrl + Shift + R`)

---

## Configuration Examples

### Display Mode
```yaml
type: custom:ace-indicator
mode: display
name: Battery
icon: mdi:battery
theme: soft
entities:
- entity: sensor.phone_battery
display_color: "#4caf50"
Thresholds Mode
YAMLtype: custom:ace-indicator
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
Boolean Mode
YAMLtype: custom:ace-indicator
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
Graph Mode
YAMLtype: custom:ace-indicator
mode: graph
name: BTC Stash
icon: mdi:chart-line
theme: default
height: 200
hours_to_show: 24
time_format: "12h"
entities:
  - entity: sensor.cryptoinfo_main_btc_stash
    color: "#ff9800"


## Options Summary

| Option            | Default     | Description                                      |
|-------------------|-------------|--------------------------------------------------|
| `mode`            | `display`   | `display` \| `thresholds` \| `boolean` \| `graph` |
| `theme`           | `default`   | `default` \| `outline` \| `soft` \| `minimal`    |
| `align`           | `center`    | `left` \| `center` \| `right`                    |
| `name`            |             | Display name                                     |
| `icon`            | `mdi:circle`| Icon (use `none` to hide)                        |
| `height`          | `36`        | Height in px                                     |
| `width`           | `140`       | Width in px (non-graph modes)                    |
| `icon_size`       | `18`        | Icon size in px                                  |
| `name_size`       | `12`        | Name text size                                   |
| `value_size`      | `14`        | Value text size                                  |
| `show_value`      | `true`      | Show numeric value                               |
| `entities`        |             | List of entities                                 |
| `thresholds`      |             | Threshold definitions                            |
| `hours_to_show`   | `24`        | Graph history length                             |
| `time_format`     | `24h`       | `12h` or `24h`                                   |
| `graph_type`      | `sparkline` | `sparkline` or `line`                            |


Layout Tips

Graph mode fills the available section width. Adjust the card’s Layout columns to control its size.
Other modes respect the configured width (in pixels). Set the Layout width appropriately so the card does not get clipped.


Version
1.5.0 — Initial public release under the ACE Indicator name.

License
MIT
textJust replace the current content of `README.md` in your repository with the text above.
