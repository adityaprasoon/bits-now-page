const API_URL = "https://script.google.com/macros/s/AKfycbySvLSySSBP-jLQpAXwzDGgRbW1ySHfKVNbIU63PcJSc1JorxnG0Sb625i4rF1jhBcirw/exec";
const REFRESH_INTERVAL_MS = 60 * 1000;
const IST_TIMEZONE = "Asia/Kolkata";
const CACHE_KEY = "now-page-last-good-payload";

const activeEventsEl = document.getElementById("active-events");
const upcomingEventsEl = document.getElementById("upcoming-events");
const passedEventsEl = document.getElementById("passed-events");
const upcomingSectionEl = document.getElementById("upcoming-section");
const passedSectionEl = document.getElementById("passed-section");
const lastUpdatedEl = document.getElementById("last-updated");
const sheetLastChangedEl = document.getElementById("sheet-last-changed");
const errorBoxEl = document.getElementById("error-box");
const clockTextEl = document.getElementById("clock-text");

clockTextEl.textContent = "All times are shown in IST";

function formatIst(isoDateTime) {
  const date = new Date(isoDateTime);
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TIMEZONE,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  }).format(date) + " IST";
}

function showError(message) {
  errorBoxEl.textContent = message;
  errorBoxEl.classList.remove("hidden");
}

function hideError() {
  errorBoxEl.textContent = "";
  errorBoxEl.classList.add("hidden");
}

function eventCard(event, styleClass, labels = { start: "Start", end: "End" }) {
  const safeDesc = event.description ? `<p>${event.description}</p>` : "";
  const linkHtml = event.link
    ? `<div class=\"link-row\"><a href=\"${event.link}\" target=\"_blank\" rel=\"noopener noreferrer\">Open Event Link</a></div>`
    : "";

  return `
    <article class="card ${styleClass}">
      <h3>${event.title}</h3>
      ${safeDesc}
      <div class="time-row">
        <span>${labels.start}: ${formatIst(event.startUtc)}</span>
        <span>${labels.end}: ${formatIst(event.endUtc)}</span>
      </div>
      ${linkHtml}
    </article>
  `;
}

function renderBoard(payload, fromCache = false) {
  const serverNow = new Date(payload.serverNowUtc);
  const events = payload.events || [];

  const active = [];
  const upcoming = [];
  const passed = [];

  events.forEach((event) => {
    const end = new Date(event.endUtc);
    const actuallyActive = Boolean(event.actuallyActive);

    // Past events are always derived from time window end.
    if (serverNow > end) {
      passed.push(event);
      return;
    }

    if (actuallyActive) {
      active.push(event);
      return;
    }

    upcoming.push(event);
  });

  upcoming.sort((a, b) => new Date(a.startUtc) - new Date(b.startUtc));
  passed.sort((a, b) => new Date(b.endUtc) - new Date(a.endUtc));

  activeEventsEl.innerHTML = active.length
    ? active.map((e) => eventCard(e, "active", { start: "Start (IST)", end: "End (IST)" })).join("")
    : '<p class="empty">No active events right now.</p>';

  const upcomingTop = upcoming.slice(0, 2);
  if (upcomingTop.length) {
    upcomingEventsEl.innerHTML = upcomingTop
      .map((e) => eventCard(e, "", { start: "Expected start (IST)", end: "Expected end (IST)" }))
      .join("");
    upcomingSectionEl.classList.remove("hidden");
  } else {
    upcomingEventsEl.innerHTML = "";
    upcomingSectionEl.classList.add("hidden");
  }

  const passedTop = passed.slice(0, 2);
  if (passedTop.length) {
    passedEventsEl.innerHTML = passedTop.map((e) => eventCard(e, "past", { start: "Start (IST)", end: "End (IST)" })).join("");
    passedSectionEl.classList.remove("hidden");
  } else {
    passedEventsEl.innerHTML = "";
    passedSectionEl.classList.add("hidden");
  }

  const suffix = fromCache ? " (cached)" : "";
  lastUpdatedEl.textContent = `Last refreshed: ${formatIst(payload.serverNowUtc)}${suffix}`;

  if (payload.lastChangedUtc) {
    sheetLastChangedEl.textContent = `Last updated (sheet): ${formatIst(payload.lastChangedUtc)}`;
  } else {
    sheetLastChangedEl.textContent = "Last updated (sheet): Not available yet";
  }
}

function saveCache(payload) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch (_err) {
    // Ignore storage failures in private browsing modes.
  }
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch (_err) {
    return null;
  }
}

async function fetchAndRender() {
  if (API_URL.includes("PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE")) {
    showError("Set your Google Apps Script Web App URL in app.js before publishing.");
    return;
  }

  try {
    const response = await fetch(API_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const payload = await response.json();
    renderBoard(payload, false);
    saveCache(payload);
    hideError();
  } catch (err) {
    const fallback = loadCache();
    if (fallback) {
      renderBoard(fallback, true);
      showError("Live data is temporarily unavailable. Showing last successful update.");
    } else {
      showError("Unable to load event data right now. Please retry in a minute.");
    }
    console.error("Now Page fetch failed:", err);
  }
}

fetchAndRender();
setInterval(fetchAndRender, REFRESH_INTERVAL_MS);
