import { csvParse } from "https://cdn.jsdelivr.net/npm/d3-dsv@3/+esm";
import * as Plot from "https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6/+esm";

const TIME_ZONE = "America/Los_Angeles";
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ROLLING_WINDOW = 10;

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

const displayTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true
});

const displayDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "numeric"
});

const tzFormatters = new Map();

const state = {
  granularity: "hourly",
  startDate: null,
  endDate: null,
  byGranularity: {
    "15min": [],
    hourly: [],
    daily: []
  },
  availableDates: [],
  rangeIndices: {
    start: 0,
    end: 0
  }
};

const elements = {
  fileInput: document.getElementById("file-input"),
  clearButton: document.getElementById("clear-data"),
  granularity: document.getElementById("granularity"),
  start: document.getElementById("start-date"),
  end: document.getElementById("end-date"),
  plot: document.getElementById("plot"),
  status: document.getElementById("chart-status"),
  sliderTrack: document.getElementById("range-track"),
  rangeStart: document.getElementById("range-start"),
  rangeEnd: document.getElementById("range-end"),
  rangeStartLabel: document.getElementById("range-start-label"),
  rangeLengthLabel: document.getElementById("range-length-label"),
  rangeEndLabel: document.getElementById("range-end-label")
};

function getDateTimeFormat(timeZone) {
  if (tzFormatters.has(timeZone)) return tzFormatters.get(timeZone);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "iso8601",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  tzFormatters.set(timeZone, formatter);
  return formatter;
}

function tzOffset(date, timeZone) {
  const dtf = getDateTimeFormat(timeZone);
  const parts = dtf.formatToParts(date);
  const values = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = Number(part.value);
    }
  }
  const zonedTime = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour,
    values.minute,
    values.second
  );
  return (zonedTime - date.getTime()) / 60000;
}

function zonedDateTimeToDate(dateStr, timeStr, timeZone = TIME_ZONE) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);
  const base = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  const offset = tzOffset(base, timeZone);
  return new Date(base.getTime() - offset * 60_000);
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function normalizeCsv(text) {
  const clean = stripBom(text);
  const lines = clean.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) =>
    line.startsWith("TYPE,DATE,START TIME,END TIME,IMPORT (kWh)")
  );
  if (headerIndex === -1) {
    throw new Error("Unable to locate CSV header row.");
  }
  return lines.slice(headerIndex).join("\n");
}

function parseUsageRows(csvText, source) {
  const rows = csvParse(csvText, (row) => {
    const date = row["DATE"];
    const startTime = row["START TIME"];
    if (!date || !startTime) return null;
    const importValue = Number.parseFloat(row["IMPORT (kWh)"]);
    const timestamp = zonedDateTimeToDate(date, startTime);
    return {
      timestamp,
      date,
      startTime,
      importKWh: Number.isFinite(importValue) ? importValue : 0,
      source,
      synthetic: false
    };
  });
  return rows.filter(Boolean).sort((a, b) => a.timestamp - b.timestamp);
}

function formatDateInZone(date) {
  return dateFormatter.format(date);
}

function formatTimeInZone(date) {
  return timeFormatter.format(date);
}

function formatDisplayTime(date) {
  return displayTimeFormatter.format(date);
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return "";
  const date = zonedDateTimeToDate(dateStr, "00:00");
  return displayDateFormatter.format(date);
}

function toDisplayTimestamp(date, timeZone = TIME_ZONE) {
  const dtf = getDateTimeFormat(timeZone);
  const parts = dtf.formatToParts(date);
  const values = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = Number(part.value);
    }
  }
  return new Date(Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour,
    values.minute,
    values.second
  ));
}

function listAvailableDates(records) {
  const dates = [];
  let previous = null;
  for (const record of records) {
    if (record.date !== previous) {
      dates.push(record.date);
      previous = record.date;
    }
  }
  return dates;
}

function computeRollingAverage(records, windowSize) {
  if (!records.length || windowSize <= 1) return [];
  const averages = [];
  let windowSum = 0;
  for (let i = 0; i < records.length; i += 1) {
    windowSum += records[i].importKWh;
    if (i >= windowSize) {
      windowSum -= records[i - windowSize].importKWh;
    }
    if (i >= windowSize - 1) {
      averages.push({
        timestamp: records[i].timestamp,
        avg: windowSum / windowSize
      });
    }
  }
  return averages;
}

function rollingUnitLabel(granularity) {
  switch (granularity) {
    case "15min":
      return "15-min intervals";
    case "hourly":
      return "hours";
    case "daily":
      return "days";
    default:
      return "intervals";
  }
}

function describeRollingWindow(granularity, windowSize) {
  if (granularity === "15min") {
    const hours = (windowSize * 15) / 60;
    const approxHours =
      hours % 1 === 0 ? `${hours.toFixed(0)} h` : `${hours.toFixed(1)} h`;
    return `${windowSize} × 15-min intervals (${approxHours})`;
  }
  const unit = rollingUnitLabel(granularity);
  return `${windowSize} ${unit}`;
}

function fillMissingIntervals(records) {
  if (records.length === 0) return [];
  const result = [];
  for (let i = 0; i < records.length; i += 1) {
    const current = records[i];
    result.push(current);
    const next = records[i + 1];
    if (!next) continue;
    let expected = new Date(current.timestamp.getTime() + FIFTEEN_MINUTES);
    while (expected < next.timestamp) {
      result.push({
        timestamp: expected,
        date: formatDateInZone(expected),
        startTime: formatTimeInZone(expected),
        importKWh: 0,
        source: "synthetic-gap-fill",
        synthetic: true
      });
      expected = new Date(expected.getTime() + FIFTEEN_MINUTES);
    }
  }
  return result;
}

function aggregate(records, granularity) {
  if (granularity === "15min") {
    return records.slice();
  }

  const buckets = new Map();

  for (const record of records) {
    if (granularity === "hourly") {
      const hour = record.startTime.slice(0, 2);
      const key = `${record.date}T${hour}`;
      if (!buckets.has(key)) {
        buckets.set(key, {
          timestamp: zonedDateTimeToDate(record.date, `${hour}:00`),
          date: record.date,
          startTime: `${hour}:00`,
          importKWh: 0,
          sampleCount: 0
        });
      }
      const bucket = buckets.get(key);
      bucket.importKWh += record.importKWh;
      bucket.sampleCount += 1;
    } else if (granularity === "daily") {
      const key = record.date;
      if (!buckets.has(key)) {
        buckets.set(key, {
          timestamp: zonedDateTimeToDate(record.date, "00:00"),
          date: record.date,
          startTime: "00:00",
          importKWh: 0,
          sampleCount: 0
        });
      }
      const bucket = buckets.get(key);
      bucket.importKWh += record.importKWh;
      bucket.sampleCount += 1;
    }
  }

  return Array.from(buckets.values()).sort(
    (a, b) => a.timestamp - b.timestamp
  );
}

function filterByRange(records, startStr, endStr) {
  if (!records.length) return records;
  if (!startStr && !endStr) return records;
  const startDate = startStr
    ? zonedDateTimeToDate(startStr, "00:00")
    : null;
  const endDateExclusive = endStr
    ? new Date(zonedDateTimeToDate(endStr, "00:00").getTime() + 86_400_000)
    : null;

  return records.filter((record) => {
    const t = record.timestamp.getTime();
    if (startDate && t < startDate.getTime()) return false;
    if (endDateExclusive && t >= endDateExclusive.getTime()) return false;
    return true;
  });
}

function updateSliderBackgrounds() {
  const { rangeStart, rangeEnd, sliderTrack } = elements;
  if (!rangeStart || !rangeEnd || !sliderTrack) return;
  const max = Number(rangeStart.max);
  if (!Number.isFinite(max) || max <= 0) {
    sliderTrack.style.setProperty("--range-start", 0);
    sliderTrack.style.setProperty("--range-end", 1);
    sliderTrack.classList.add("disabled");
    return;
  }
  sliderTrack.classList.toggle(
    "disabled",
    rangeStart.disabled || rangeEnd.disabled
  );
  const startFraction = Math.max(
    0,
    Math.min(1, Number(rangeStart.value) / max)
  );
  const endFraction = Math.max(0, Math.min(1, Number(rangeEnd.value) / max));
  sliderTrack.style.setProperty("--range-start", startFraction);
  sliderTrack.style.setProperty("--range-end", endFraction);
}

function updateSliderLabels() {
  const { rangeStartLabel, rangeEndLabel, rangeLengthLabel } = elements;
  if (!rangeStartLabel || !rangeEndLabel || !rangeLengthLabel) return;
  const dates = state.availableDates;
  if (!dates.length) {
    rangeStartLabel.textContent = "No data";
    rangeEndLabel.textContent = "";
    rangeLengthLabel.textContent = "";
    return;
  }
  const startDate = dates[state.rangeIndices.start] ?? dates[0];
  const endDate = dates[state.rangeIndices.end] ?? dates.at(-1);
  rangeStartLabel.textContent = formatDisplayDate(startDate);
  rangeEndLabel.textContent = formatDisplayDate(endDate);
  if (startDate && endDate) {
    const start = zonedDateTimeToDate(startDate, "00:00");
    const end = zonedDateTimeToDate(endDate, "00:00");
    const differenceDays = Math.abs(
      Math.round((end.getTime() - start.getTime()) / 86_400_000)
    ) + 1;
    rangeLengthLabel.textContent =
      differenceDays > 1 ? `${differenceDays} days` : "1 day";
  } else {
    rangeLengthLabel.textContent = "";
  }
}

function syncSliderToState() {
  if (!state.availableDates.length) return;
  const maxIndex = state.availableDates.length - 1;
  let startIndex = state.startDate
    ? state.availableDates.indexOf(state.startDate)
    : 0;
  let endIndex = state.endDate
    ? state.availableDates.indexOf(state.endDate)
    : maxIndex;
  if (startIndex === -1) startIndex = 0;
  if (endIndex === -1) endIndex = maxIndex;
  startIndex = Math.max(0, Math.min(startIndex, maxIndex));
  endIndex = Math.max(startIndex, Math.min(endIndex, maxIndex));
  state.rangeIndices.start = startIndex;
  state.rangeIndices.end = endIndex;
  elements.rangeStart.value = String(startIndex);
  elements.rangeEnd.value = String(endIndex);
  updateSliderLabels();
  updateSliderBackgrounds();
}

function initializeRangeSlider() {
  const { rangeStart, rangeEnd } = elements;
  if (!rangeStart || !rangeEnd) return;
  const dates = state.availableDates;
  if (!dates.length) {
    rangeStart.disabled = true;
    rangeEnd.disabled = true;
    updateSliderLabels();
    updateSliderBackgrounds();
    return;
  }
  const maxIndex = dates.length - 1;
  rangeStart.disabled = false;
  rangeEnd.disabled = false;
  rangeStart.min = "0";
  rangeEnd.min = "0";
  rangeStart.max = String(maxIndex);
  rangeEnd.max = String(maxIndex);
  syncSliderToState();
  updateSliderBackgrounds();
}

function onSliderChange(event) {
  if (!state.availableDates.length) return;
  let startIndex = Number(elements.rangeStart.value);
  let endIndex = Number(elements.rangeEnd.value);
  if (startIndex > endIndex) {
    if (event?.target === elements.rangeStart) {
      startIndex = endIndex;
      elements.rangeStart.value = String(startIndex);
    } else {
      endIndex = startIndex;
      elements.rangeEnd.value = String(endIndex);
    }
  }
  const maxIndex = state.availableDates.length - 1;
  startIndex = Math.max(0, Math.min(startIndex, maxIndex));
  endIndex = Math.max(startIndex, Math.min(endIndex, maxIndex));
  state.rangeIndices.start = startIndex;
  state.rangeIndices.end = endIndex;
  state.startDate = state.availableDates[startIndex];
  state.endDate = state.availableDates[endIndex];
  elements.start.value = state.startDate;
  elements.end.value = state.endDate;
  updateSliderLabels();
  updateSliderBackgrounds();
  updateChart();
}

function buildTooltip(d, granularity, avgMap, windowSize) {
  const dateLabel = formatDateInZone(d.timestamp);
  const timeLabel =
    granularity === "daily" ? "" : ` ${formatDisplayTime(d.timestamp)}`;
  const kwh = d.importKWh.toFixed(3);
  let avgLine = "";
  if (avgMap && avgMap.has(d.timestamp.getTime())) {
    const avgValue = avgMap.get(d.timestamp.getTime());
    const unitLabel = rollingUnitLabel(granularity);
    avgLine = `\nRolling avg (${windowSize} ${unitLabel}): ${avgValue.toFixed(
      3
    )} kWh`;
  }
  return `${dateLabel}${timeLabel}\nImport: ${kwh} kWh${avgLine}`;
}

function renderPlot(records, rolling, granularity, windowSize) {
  if (!records.length) {
    elements.plot.replaceChildren();
    return;
  }

  const width = Math.max(elements.plot.clientWidth, 640);
  const avgMap = new Map(
    rolling.map((entry) => [entry.timestamp.getTime(), entry.avg])
  );

  const plot = Plot.plot({
    marginTop: 32,
    marginBottom: 48,
    width,
    color: { scheme: "turbo", legend: false },
    y: {
      label: "Usage (kWh)",
      grid: true
    },
    x: {
      label: "Date",
      type: "utc"
    },
    marks: [
      Plot.ruleY([0]),
      Plot.lineY(records, {
        x: (d) => toDisplayTimestamp(d.timestamp),
        y: "importKWh",
        stroke: "#0070f3",
        strokeWidth: 1.5
      }),
      Plot.areaY(records, {
        x: (d) => toDisplayTimestamp(d.timestamp),
        y: "importKWh",
        fill: "#0070f3",
        fillOpacity: 0.15
      })
    ]
      .concat(
        rolling.length
          ? [
              Plot.lineY(rolling, {
                x: (d) => toDisplayTimestamp(d.timestamp),
                y: "avg",
                stroke: "#f97316",
                strokeWidth: 1.5,
                strokeDasharray: "6,4",
                strokeOpacity: 0.9
              })
            ]
          : []
      )
      .concat([
      Plot.tip(
        records,
        Plot.pointerX({
          x: (d) => toDisplayTimestamp(d.timestamp),
          y: "importKWh",
          title: (d) => buildTooltip(d, granularity, avgMap, windowSize),
          anchor: "bottom"
        })
      )
    ])
  });

  elements.plot.replaceChildren(plot);
}

function updateStatus(filtered, granularity, rolling, windowSize) {
  if (!filtered.length) {
    elements.status.textContent =
      "No data in the selected range. Try expanding the dates.";
    return;
  }
  const start = filtered[0].timestamp;
  const end = filtered.at(-1).timestamp;
  const startLabel =
    granularity === "daily"
      ? formatDateInZone(start)
      : `${formatDateInZone(start)} ${formatDisplayTime(start)}`;
  const endLabel =
    granularity === "daily"
      ? formatDateInZone(end)
      : `${formatDateInZone(end)} ${formatDisplayTime(end)}`;
  const totalKWh = filtered
    .reduce((sum, d) => sum + d.importKWh, 0)
    .toFixed(2);
  const unit = granularity === "15min" ? "points" : granularity;

  const summaryParts = [
    `Showing ${filtered.length} ${unit} from ${startLabel} through ${endLabel}`,
    `Total import ${totalKWh} kWh`
  ];
  if (rolling?.length) {
    summaryParts.push(
      `Rolling avg window ${describeRollingWindow(granularity, windowSize)}`
    );
  }
  elements.status.textContent = summaryParts.join(" · ");
}

function updateChart() {
  const series = state.byGranularity[state.granularity] ?? [];
  const filtered = filterByRange(
    series,
    state.startDate,
    state.endDate
  );
  const rolling = computeRollingAverage(filtered, ROLLING_WINDOW);
  renderPlot(filtered, rolling, state.granularity, ROLLING_WINDOW);
  updateStatus(filtered, state.granularity, rolling, ROLLING_WINDOW);
  updateSliderBackgrounds();
}

function onGranularityChange(event) {
  state.granularity = event.target.value;
  updateChart();
}

function clampDateInputs() {
  const minDate = state.availableDates[0] ?? null;
  const maxDate = state.availableDates.at(-1) ?? null;
  if (!minDate || !maxDate) return;
  elements.start.min = minDate;
  elements.start.max = maxDate;
  elements.end.min = minDate;
  elements.end.max = maxDate;
  if (!state.startDate) {
    state.startDate = minDate;
    elements.start.value = minDate;
  }
  if (!state.endDate) {
    state.endDate = maxDate;
    elements.end.value = maxDate;
  }
  elements.start.value = state.startDate;
  elements.end.value = state.endDate;
}

function onRangeChange() {
  const startValue = elements.start.value;
  const endValue = elements.end.value;
  if (startValue && endValue && startValue > endValue) {
    if (this === elements.start) {
      elements.end.value = startValue;
      state.endDate = startValue;
    } else {
      elements.start.value = endValue;
      state.startDate = endValue;
    }
  } else {
    state.startDate = startValue || null;
    state.endDate = endValue || null;
  }
  syncSliderToState();
  updateChart();
}

async function loadUsageData(files) {
  if (!files || !files.length) {
    throw new Error("No files provided.");
  }

  const readFile = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const text = event.target.result;
          const normalized = normalizeCsv(text);
          const records = parseUsageRows(normalized, file.name);
          resolve(records);
        } catch (error) {
          reject(new Error(`Failed to parse ${file.name}: ${error.message}`));
        }
      };
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
      reader.readAsText(file);
    });
  };

  const newRecordsArrays = await Promise.all(
    Array.from(files).map((file) => readFile(file))
  );

  const existingRecords = await loadAllRecords();
  const recordsByTimestamp = new Map();

  for (const record of existingRecords) {
    recordsByTimestamp.set(record.timestamp.getTime(), record);
  }

  for (const records of newRecordsArrays) {
    for (const record of records) {
      recordsByTimestamp.set(record.timestamp.getTime(), record);
    }
  }

  const merged = Array.from(recordsByTimestamp.values()).sort(
    (a, b) => a.timestamp - b.timestamp
  );

  await saveRecords(merged);

  const filled = fillMissingIntervals(merged);

  state.byGranularity["15min"] = filled;
  state.byGranularity.hourly = aggregate(filled, "hourly");
  state.byGranularity.daily = aggregate(filled, "daily");
  state.availableDates = listAvailableDates(filled);
  if (state.availableDates.length) {
    state.rangeIndices.start = 0;
    state.rangeIndices.end = state.availableDates.length - 1;
    state.startDate = state.availableDates[0];
    state.endDate = state.availableDates.at(-1);
  } else {
    state.rangeIndices.start = 0;
    state.rangeIndices.end = 0;
    state.startDate = null;
    state.endDate = null;
  }
}

const DB_NAME = "scl-usage-data";
const DB_VERSION = 1;
const STORE_NAME = "intervals";

async function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "timestampKey" });
      }
    };
  });
}

async function saveRecords(records) {
  const db = await openDatabase();
  const transaction = db.transaction([STORE_NAME], "readwrite");
  const store = transaction.objectStore(STORE_NAME);

  for (const record of records) {
    const timestampKey = record.timestamp.getTime();
    store.put({ ...record, timestampKey });
  }

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

async function loadAllRecords() {
  const db = await openDatabase();
  const transaction = db.transaction([STORE_NAME], "readonly");
  const store = transaction.objectStore(STORE_NAME);

  return new Promise((resolve, reject) => {
    const request = store.getAll();

    request.onsuccess = () => {
      db.close();
      const records = request.result.map((record) => ({
        timestamp: new Date(record.timestampKey),
        date: record.date,
        startTime: record.startTime,
        importKWh: record.importKWh,
        source: record.source,
        synthetic: record.synthetic
      }));
      records.sort((a, b) => a.timestamp - b.timestamp);
      resolve(records);
    };

    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

async function clearAllRecords() {
  const db = await openDatabase();
  const transaction = db.transaction([STORE_NAME], "readwrite");
  const store = transaction.objectStore(STORE_NAME);

  return new Promise((resolve, reject) => {
    const request = store.clear();

    request.onsuccess = () => {
      db.close();
      resolve();
    };

    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

async function onFilesSelected(event) {
  const files = event.target.files;
  if (!files || !files.length) return;

  elements.status.textContent = `Loading ${files.length} file(s)...`;

  try {
    await loadUsageData(files);
    clampDateInputs();
    initializeRangeSlider();
    updateChart();
  } catch (error) {
    console.error(error);
    elements.status.textContent = `Failed to load files: ${error.message}`;
  }

  event.target.value = "";
}

async function onClearData() {
  if (!confirm("Clear all stored data? This cannot be undone.")) {
    return;
  }

  try {
    await clearAllRecords();

    state.byGranularity["15min"] = [];
    state.byGranularity.hourly = [];
    state.byGranularity.daily = [];
    state.availableDates = [];
    state.startDate = null;
    state.endDate = null;
    state.rangeIndices.start = 0;
    state.rangeIndices.end = 0;

    elements.plot.replaceChildren();
    elements.status.textContent = "Data cleared. Load CSV files to begin.";
    elements.start.value = "";
    elements.end.value = "";
    initializeRangeSlider();
  } catch (error) {
    console.error(error);
    elements.status.textContent = `Failed to clear data: ${error.message}`;
  }
}

function setupDragAndDrop() {
  const dragOverlay = document.getElementById("drag-overlay");
  let dragCounter = 0;

  const handleDragEnter = (event) => {
    event.preventDefault();
    dragCounter++;
    if (dragCounter === 1) {
      dragOverlay.classList.add("active");
    }
  };

  const handleDragOver = (event) => {
    event.preventDefault();
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    dragCounter--;
    if (dragCounter === 0) {
      dragOverlay.classList.remove("active");
    }
  };

  const handleDrop = async (event) => {
    event.preventDefault();
    dragCounter = 0;
    dragOverlay.classList.remove("active");

    const files = event.dataTransfer?.files;
    if (!files || !files.length) return;

    const csvFiles = Array.from(files).filter((file) =>
      file.name.toLowerCase().endsWith(".csv")
    );

    if (csvFiles.length === 0) {
      elements.status.textContent = "No CSV files found in dropped items.";
      return;
    }

    elements.status.textContent = `Loading ${csvFiles.length} file(s)...`;

    try {
      await loadUsageData(csvFiles);
      clampDateInputs();
      initializeRangeSlider();
      updateChart();
    } catch (error) {
      console.error(error);
      elements.status.textContent = `Failed to load files: ${error.message}`;
    }
  };

  document.body.addEventListener("dragenter", handleDragEnter);
  document.body.addEventListener("dragover", handleDragOver);
  document.body.addEventListener("dragleave", handleDragLeave);
  document.body.addEventListener("drop", handleDrop);
}

async function init() {
  try {
    const existingRecords = await loadAllRecords();

    if (existingRecords.length > 0) {
      const filled = fillMissingIntervals(existingRecords);
      state.byGranularity["15min"] = filled;
      state.byGranularity.hourly = aggregate(filled, "hourly");
      state.byGranularity.daily = aggregate(filled, "daily");
      state.availableDates = listAvailableDates(filled);
      if (state.availableDates.length) {
        state.rangeIndices.start = 0;
        state.rangeIndices.end = state.availableDates.length - 1;
        state.startDate = state.availableDates[0];
        state.endDate = state.availableDates.at(-1);
      }
    } else {
      elements.status.textContent = "No data loaded. Use 'Load CSV files' to get started.";
    }

    clampDateInputs();
    initializeRangeSlider();
    elements.granularity.value = state.granularity;
    elements.granularity.addEventListener("change", onGranularityChange);
    elements.start.addEventListener("change", onRangeChange);
    elements.end.addEventListener("change", onRangeChange);
    elements.rangeStart?.addEventListener("input", onSliderChange);
    elements.rangeEnd?.addEventListener("input", onSliderChange);
    elements.fileInput?.addEventListener("change", onFilesSelected);
    elements.clearButton?.addEventListener("click", onClearData);

    setupDragAndDrop();

    const darkModeQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
    const themeListener = () => updateSliderBackgrounds();
    if (darkModeQuery) {
      if (typeof darkModeQuery.addEventListener === "function") {
        darkModeQuery.addEventListener("change", themeListener);
      } else if (typeof darkModeQuery.addListener === "function") {
        darkModeQuery.addListener(themeListener);
      }
    }

    if (existingRecords.length > 0) {
      updateChart();
    }
  } catch (error) {
    console.error(error);
    elements.status.textContent = `Failed to initialize: ${error.message}`;
  }
}

init();
