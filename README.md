## Electricity usage

A tool to visualize usage data from Seattle City Light.

## Usage

    npx serve

## Design specifications

- Load usage CSVs, standardize timestamps, and compute optional hourly/daily aggregates.
    - Data may overlap and should be deduplicated by taking the later record. Ordering files by name should help, since it naturally sorts from early to late (see filename format described earlier).
- Expose the processed data via a simple endpoint or static JSON grouped by date range.
- Build a basic page with controls for date-range selection and granularity (15 min/hour/day).
- Visualize the filtered data with an area chart.
    - X-axis: Date
    - Y-axis: Usage (kWh)
    - X-axis should be zoomable.
    - Data point on-hover should show a tooltip with datetime in format `YYYY-MM-DD (H)H:MM <AM/PM>` and usage value for the data point.

## Technical specifications

- Bundle a minimal static page that loads usage CSVs via `fetch`, parses them with `d3-dsv`, and caches per-granularity datasets (15 min/hour/day).
- Plot the data under the import column. Fill in missing data (e.g. DST jumps with 0 kWh).
- Import Observable Plot and `d3-dsv` directly from CDN ESM URLs inside a `<script type="module">`.
- Use a simple control panel (selects/buttons) wired to re-render `Plot.plot` with the chosen aggregate.
- Since [zoom is not available](https://github.com/observablehq/plot/issues/1590), add a date range slider to control the date bounds.
- Keep state in plain JavaScript modules; no build step required beyond serving the static files.

## Environment requirements

- `npx serve` to host the HTML/JS locally.
- Modern browser with ES modules support for running the client code.
- Outbound access to CDN hosts for loading Observable Plot and `d3-dsv` modules at runtime.

## Seattle City Light's file formats

## Usage data

`scl_electric_usage_interval_data_{service_id}_{service_index}_{start_date}_to_{end_date}.csv`

- Four metadata rows: `Name`, `Address`, `Account Number`, `Service`
- Blank spacer row
- Column header row: `TYPE,DATE,START TIME,END TIME,IMPORT (kWh),EXPORT (kWh),NOTES`
- Data rows: 15-minute interval usage records with imports/exports in kWh and optional notes
- Time data is in the `America/Los_Angeles` time zone.
    - For DST ends in November, quarter-hour records run 01:45→02:00 without repeating the 01:xx block so the extra hour from the fall-back transition is not represented.
    - For DST begins in March, the series jumps from the 01:45 interval straight to 03:00.

### Billing data (unused)

`scl_electric_billing_billing_data_{service_id}_{service_index}_{start_date}_to_{end_date}.csv`

- Four metadata rows: `Name`, `Address`, `Account Number`, `Service`
- Blank spacer row
- Column header row: `TYPE,START DATE,END DATE,USAGE (kWh),COST,NOTES`
- Data rows: one record per billing period with usage in kWh, cost as currency string, and optional notes
