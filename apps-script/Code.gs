const SHEET_NAME = "Events";
const TIMEZONE = "Asia/Kolkata";
const LAST_CHANGED_PROP = "LastChangedUTC";
const IST_OFFSET_MINUTES = 330;

function doGet() {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);

    if (!sheet) {
      return jsonOutput({
        serverNowUtc: new Date().toISOString(),
        lastChangedUtc: getLastChangedUtc(),
        timezone: TIMEZONE,
        events: [],
        error: "Sheet not found. Create a sheet named Events."
      });
    }

    const values = sheet.getDataRange().getValues();
    if (values.length <= 1) {
      return jsonOutput({
        serverNowUtc: new Date().toISOString(),
        lastChangedUtc: getLastChangedUtc(),
        timezone: TIMEZONE,
        events: []
      });
    }

    const headers = values[0].map((h) => String(h).trim());
    const idx = {
      title: headers.indexOf("Title"),
      description: headers.indexOf("Description"),
      startIst: headers.indexOf("StartIST"),
      endIst: headers.indexOf("EndIST"),
      startUtc: headers.indexOf("StartUTC"),
      endUtc: headers.indexOf("EndUTC"),
      actuallyActive: headers.indexOf("ActuallyActive"),
      visible: headers.indexOf("Visible"),
      link: headers.indexOf("Link")
    };

    const events = [];

    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      const title = idx.title >= 0 ? String(row[idx.title] || "").trim() : "";
      const description = idx.description >= 0 ? String(row[idx.description] || "").trim() : "";
      const startInput = idx.startIst >= 0
        ? String(row[idx.startIst] || "").trim()
        : (idx.startUtc >= 0 ? String(row[idx.startUtc] || "").trim() : "");
      const endInput = idx.endIst >= 0
        ? String(row[idx.endIst] || "").trim()
        : (idx.endUtc >= 0 ? String(row[idx.endUtc] || "").trim() : "");
      const actuallyActiveRaw = idx.actuallyActive >= 0 ? String(row[idx.actuallyActive] || "FALSE").trim() : "FALSE";
      const link = idx.link >= 0 ? String(row[idx.link] || "").trim() : "";
      const visibleRaw = idx.visible >= 0 ? String(row[idx.visible] || "TRUE").trim() : "TRUE";

      const actuallyActive = /^(true|1|yes|y)$/i.test(actuallyActiveRaw);
      const visible = /^(true|1|yes|y)$/i.test(visibleRaw);
      const startUtc = parseInputToUtcIso(startInput);
      const endUtc = parseInputToUtcIso(endInput);

      if (!visible || !title || !startUtc || !endUtc) {
        continue;
      }

      events.push({
        title: title,
        description: description,
        startUtc: startUtc,
        endUtc: endUtc,
        actuallyActive: actuallyActive,
        link: link
      });
    }

    return jsonOutput({
      serverNowUtc: new Date().toISOString(),
      lastChangedUtc: getLastChangedUtc(),
      timezone: TIMEZONE,
      events: events
    });
  } catch (error) {
    return jsonOutput({
      serverNowUtc: new Date().toISOString(),
      lastChangedUtc: getLastChangedUtc(),
      timezone: TIMEZONE,
      events: [],
      error: String(error)
    });
  }
}

function jsonOutput(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function onEdit(e) {
  PropertiesService.getScriptProperties().setProperty(LAST_CHANGED_PROP, new Date().toISOString());
}

function getLastChangedUtc() {
  return PropertiesService.getScriptProperties().getProperty(LAST_CHANGED_PROP) || null;
}

function parseInputToUtcIso(rawValue) {
  if (!rawValue) {
    return null;
  }

  // If timezone info is already present, use it directly.
  if (/z$/i.test(rawValue) || /[+-]\d\d:\d\d$/.test(rawValue)) {
    const dated = new Date(rawValue);
    if (isNaN(dated.getTime())) {
      return null;
    }
    return dated.toISOString();
  }

  // Parse IST text like "YYYY-MM-DDTHH:mm", "YYYY-MM-DD HH:mm", optionally with seconds.
  const match = rawValue.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] || "0");

  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second) - (IST_OFFSET_MINUTES * 60 * 1000);
  return new Date(utcMs).toISOString();
}
