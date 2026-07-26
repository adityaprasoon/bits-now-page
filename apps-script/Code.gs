const SHEET_NAME = "Events";
const TIMEZONE = "Asia/Kolkata";
const LAST_CHANGED_PROP = "LastChangedUTC";

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
      const startUtc = idx.startUtc >= 0 ? String(row[idx.startUtc] || "").trim() : "";
      const endUtc = idx.endUtc >= 0 ? String(row[idx.endUtc] || "").trim() : "";
      const actuallyActiveRaw = idx.actuallyActive >= 0 ? String(row[idx.actuallyActive] || "FALSE").trim() : "FALSE";
      const link = idx.link >= 0 ? String(row[idx.link] || "").trim() : "";
      const visibleRaw = idx.visible >= 0 ? String(row[idx.visible] || "TRUE").trim() : "TRUE";

      const actuallyActive = /^(true|1|yes|y)$/i.test(actuallyActiveRaw);
      const visible = /^(true|1|yes|y)$/i.test(visibleRaw);

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
