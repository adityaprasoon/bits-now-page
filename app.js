const REFRESH_INTERVAL_MS = 60 * 1000;
const STALE_AFTER_MS = 30 * 60 * 1000;
const IST_TIMEZONE = "Asia/Kolkata";
const CACHE_KEY = "now-page-supabase-last-good-payload";
const CACHE_UPDATED_AT_KEY = "now-page-last-successful-refresh";
const FAVORITES_KEY = "now-page-favorite-subjects";
const SUPABASE_CONFIG = window.SUPABASE_CONFIG || {};
const SUPABASE_URL = (SUPABASE_CONFIG.url || "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = SUPABASE_CONFIG.anonKey || "";

const activeEventsEl = document.getElementById("active-events");
const upcomingEventsEl = document.getElementById("upcoming-events");
const passedEventsEl = document.getElementById("passed-events");
const upcomingSectionEl = document.getElementById("upcoming-section");
const passedSectionEl = document.getElementById("passed-section");
const lastUpdatedEl = document.getElementById("last-updated");
const dataLastChangedEl = document.getElementById("data-last-changed");
const errorBoxEl = document.getElementById("error-box");
const clockTextEl = document.getElementById("clock-text");
const refreshButtonEl = document.getElementById("refresh-button");
const subjectFilterEl = document.getElementById("subject-filter");
const subjectFilterStatusEl = document.getElementById("subject-filter-status");
const favoritesDialogEl = document.getElementById("favorites-dialog");
const favoritesListEl = document.getElementById("favorites-list");
const saveFavoritesButtonEl = document.getElementById("save-favorites");
const clearFavoritesButtonEl = document.getElementById("clear-favorites");
const manageFavoritesButtonEl = document.getElementById("manage-favorites");

function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch (_err) {
    return fallback;
  }
}

function readFavoriteIds() {
  try {
    const parsed = JSON.parse(readStorage(FAVORITES_KEY, "[]"));
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch (_err) {
    return [];
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (_err) {
    showError("Browser storage is unavailable. Favourite subjects may not be saved.");
  }
}

let favoriteSubjectIds = readFavoriteIds();
let subjects = [];
let allEvents = [];
let lastSuccessfulFetchAt = Number(readStorage(CACHE_UPDATED_AT_KEY, Date.now()));
if (!Number.isFinite(lastSuccessfulFetchAt) || lastSuccessfulFetchAt <= 0) {
  lastSuccessfulFetchAt = Date.now();
}
let isFetching = false;

clockTextEl.textContent = "All times are shown in IST";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function formatIst(isoDateTime) {
  const date = new Date(isoDateTime);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TIMEZONE,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  }).format(date);
}

const URGENCY_THRESHOLDS = {
  quiz: 6 * 60 * 60 * 1000,
  assignment: 2 * 24 * 60 * 60 * 1000
};
const URGENCY_DEFAULT_MS = 6 * 60 * 60 * 1000;

function formatDuration(ms) {
  if (ms <= 0) return "0m";
  const totalMins = Math.floor(ms / 60000);
  const days = Math.floor(totalMins / 1440);
  const hours = Math.floor((totalMins % 1440) / 60);
  const mins = totalMins % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

function urgencyThreshold(title) {
  const normalizedTitle = String(title).toLowerCase();
  if (normalizedTitle.includes("quiz")) return URGENCY_THRESHOLDS.quiz;
  if (normalizedTitle.includes("assignment")) return URGENCY_THRESHOLDS.assignment;
  return URGENCY_DEFAULT_MS;
}

function showError(message) {
  errorBoxEl.textContent = message;
  errorBoxEl.classList.remove("hidden");
}

function hideError() {
  errorBoxEl.textContent = "";
  errorBoxEl.classList.add("hidden");
}

function safeLink(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return `<div class="link-row"><a href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">Open Event Link</a></div>`;
  } catch (_err) {
    return "";
  }
}

function eventCard(event, styleClass, serverNow, labels) {
  const startDate = new Date(event.start_at);
  const endDate = new Date(event.end_at);
  const duration = formatDuration(endDate - startDate);
  const msLeft = endDate - serverNow;
  const urgent = msLeft < urgencyThreshold(event.title);
  const subject = event.subject || {};

  return `
    <article class="card ${styleClass} ${urgent && styleClass === "active" ? "urgent" : ""}">
      <div class="subject-identity">
        <span class="subject-code">${escapeHtml(subject.code || "Subject")}</span>
        <span class="subject-name">${escapeHtml(subject.name || "")}</span>
        <span class="duration-total"><span aria-hidden="true">◷</span> ${duration}<span class="visually-hidden"> duration</span></span>
      </div>
      <h3>${escapeHtml(event.title)}</h3>
      ${event.description ? `<p>${escapeHtml(event.description)}</p>` : ""}
      <div class="time-row">
        <span class="time-pill"><span class="time-label">${labels.start}</span><time>${formatIst(event.start_at)} IST</time></span>
        <span class="time-pill"><span class="time-label">${labels.end}</span><time>${formatIst(event.end_at)} IST</time></span>
      </div>
      ${styleClass === "active" ? `<div class="duration-row"><span class="time-left ${urgent ? "time-left-urgent" : ""}"><span aria-hidden="true">⌛</span> ${formatDuration(msLeft)} left</span></div>` : ""}
      ${safeLink(event.link)}
    </article>
  `;
}

function currentSubjectFilter() {
  return subjectFilterEl.value || (favoriteSubjectIds.length ? "favorites" : "all");
}

function getVisibleEvents() {
  const filter = currentSubjectFilter();
  if (filter === "all") return allEvents;
  const favorites = new Set(favoriteSubjectIds);
  return allEvents.filter((event) => favorites.has(event.subject_id));
}

function renderSubjectFilterStatus() {
  if (currentSubjectFilter() === "all") {
    subjectFilterStatusEl.textContent = "Showing all subjects";
    return;
  }

  const favoriteCodes = subjects
    .filter((subject) => favoriteSubjectIds.includes(subject.id))
    .map((subject) => subject.code);
  subjectFilterStatusEl.textContent = favoriteCodes.length
    ? `Showing favourite subjects: ${favoriteCodes.join(", ")}`
    : "Showing favourite subjects: none selected";
}

function renderBoard() {
  renderSubjectFilterStatus();
  const now = new Date();
  const events = getVisibleEvents().filter((event) => !event.is_hidden);
  const active = [];
  const upcoming = [];
  const passed = [];

  events.forEach((event) => {
    const start = new Date(event.start_at);
    const end = new Date(event.end_at);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return;
    if (now >= start && now <= end) {
      active.push(event);
    } else if (now < start) {
      upcoming.push(event);
    } else if (now > end) {
      passed.push(event);
    }
  });

  upcoming.sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
  passed.sort((a, b) => new Date(b.end_at) - new Date(a.end_at));
  active.sort((a, b) => new Date(a.end_at) - new Date(b.end_at));

  activeEventsEl.innerHTML = active.length
    ? active.map((event) => eventCard(event, "active", now, { start: "Starts at", end: "Ends at" })).join("")
    : '<p class="empty">No active events right now.</p>';

  const upcomingTop = upcoming.slice(0, 2);
  upcomingEventsEl.innerHTML = upcomingTop
    .map((event) => eventCard(event, "", now, { start: "Starts at", end: "Ends at" }))
    .join("");
  upcomingSectionEl.classList.toggle("hidden", !upcomingTop.length);

  const passedTop = passed.slice(0, 2);
  passedEventsEl.innerHTML = passedTop
    .map((event) => eventCard(event, "past", now, { start: "Starts at", end: "Ends at" }))
    .join("");
  passedSectionEl.classList.toggle("hidden", !passedTop.length);
}

function renderSubjectFilter() {
  const previouslySelected = subjectFilterEl.value;
  subjectFilterEl.replaceChildren();
  const favoritesOption = new Option("Favourite subjects", "favorites");
  subjectFilterEl.add(favoritesOption);
  subjectFilterEl.add(new Option("All subjects", "all"));

  const defaultFilter = favoriteSubjectIds.length ? "favorites" : "all";
  subjectFilterEl.value = ["favorites", "all"].includes(previouslySelected)
    && (previouslySelected !== "favorites" || favoriteSubjectIds.length)
    ? previouslySelected
    : defaultFilter;
  renderBoard();
}

function renderFavoritesDialog() {
  const draftFavorites = new Set(favoriteSubjectIds);
  favoritesListEl.replaceChildren();
  if (!subjects.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No subjects are available yet.";
    favoritesListEl.append(empty);
    return;
  }

  subjects.forEach((subject) => {
    const label = document.createElement("label");
    label.className = "favorite-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = subject.id;
    checkbox.checked = draftFavorites.has(subject.id);
    const identity = document.createElement("span");
    identity.className = "favorite-option-identity";
    const code = document.createElement("strong");
    code.textContent = subject.code;
    const name = document.createElement("span");
    name.textContent = subject.name;
    identity.append(code, name);
    label.append(checkbox, identity);
    favoritesListEl.append(label);
  });
}

function loadCache() {
  try {
    const raw = readStorage(CACHE_KEY, "");
    return raw ? JSON.parse(raw) : null;
  } catch (_err) {
    return null;
  }
}

function saveCache(payload) {
  writeStorage(CACHE_KEY, JSON.stringify(payload));
}

function updateRefreshButton() {
  const isStale = Date.now() - lastSuccessfulFetchAt >= STALE_AFTER_MS;
  refreshButtonEl.classList.toggle("stale", isStale);
  refreshButtonEl.setAttribute(
    "aria-label",
    isStale ? "Refresh event data. Data may be stale." : "Refresh event data"
  );
  refreshButtonEl.innerHTML = '<span aria-hidden="true">↻</span>';
}

function applyPayload(payload) {
  subjects = Array.isArray(payload.subjects) ? payload.subjects : [];
  allEvents = Array.isArray(payload.events) ? payload.events : [];
  const validIds = new Set(subjects.map((subject) => subject.id));
  favoriteSubjectIds = favoriteSubjectIds.filter((id) => validIds.has(id));
  writeStorage(FAVORITES_KEY, JSON.stringify(favoriteSubjectIds));
  renderSubjectFilter();

  lastUpdatedEl.textContent = `Page refreshed at: ${formatIst(payload.serverNowUtc)} IST`;
  dataLastChangedEl.textContent = payload.lastChangedUtc
    ? `Data updated at: ${formatIst(payload.lastChangedUtc)} IST`
    : "Data updated at: Not available yet";
}

async function fetchSupabaseTable(table, query) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    cache: "no-store",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: "Bearer " + SUPABASE_ANON_KEY,
    }
  });
  if (!response.ok) {
    const message = response.status === 401 || response.status === 403
      ? "Supabase rejected the public read. Check the project URL, publishable key, and RLS policies."
      : `Supabase request failed (${response.status}).`;
    throw new Error(message);
  }
  return response.json();
}

async function fetchBoardData() {
  const [subjectRows, eventRows, metadataRows] = await Promise.all([
    fetchSupabaseTable("subjects", "select=id,code,name&order=code.asc"),
    fetchSupabaseTable(
      "events",
      "select=id,subject_id,title,description,start_at,end_at,is_hidden,link,subjects(code,name)&is_hidden=eq.false&order=start_at.asc"
    ),
    fetchSupabaseTable("content_metadata", "select=updated_at&limit=1")
  ]);

  return {
    serverNowUtc: new Date().toISOString(),
    lastChangedUtc: metadataRows[0]?.updated_at || null,
    subjects: subjectRows,
    events: eventRows.map((event) => ({
      ...event,
      subject: Array.isArray(event.subjects) ? event.subjects[0] : event.subjects,
      subjects: undefined
    }))
  };
}

async function fetchAndRender() {
  if (isFetching) return;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    showError("Add your Supabase project URL and publishable key to supabase-config.js to load event data.");
    return;
  }

  isFetching = true;
  refreshButtonEl.disabled = true;
  refreshButtonEl.classList.add("loading");
  refreshButtonEl.innerHTML = '<span aria-hidden="true">↻</span>';

  try {
    const payload = await fetchBoardData();
    applyPayload(payload);
    saveCache(payload);
    lastSuccessfulFetchAt = Date.now();
    writeStorage(CACHE_UPDATED_AT_KEY, String(lastSuccessfulFetchAt));
    hideError();
  } catch (error) {
    const cachedPayload = loadCache();
    if (cachedPayload) {
      applyPayload(cachedPayload);
      showError(`Live data is unavailable. Showing the last saved data. ${error.message}`);
    } else {
      showError(error.message || "Unable to load event data. Check your Supabase connection.");
    }
    console.error("Supabase data fetch failed:", error);
  } finally {
    isFetching = false;
    refreshButtonEl.disabled = false;
    refreshButtonEl.classList.remove("loading");
    updateRefreshButton();
  }
}

document.getElementById("manage-favorites").addEventListener("click", () => {
  renderFavoritesDialog();
  favoritesDialogEl.showModal();
});

saveFavoritesButtonEl.addEventListener("click", () => {
  favoriteSubjectIds = Array.from(
    favoritesListEl.querySelectorAll('input[type="checkbox"]:checked'),
    (checkbox) => checkbox.value
  );
  writeStorage(FAVORITES_KEY, JSON.stringify(favoriteSubjectIds));
  subjectFilterEl.value = favoriteSubjectIds.length ? "favorites" : "all";
  favoritesDialogEl.close();
  renderBoard();
});

clearFavoritesButtonEl.addEventListener("click", () => {
  favoritesListEl.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.checked = false;
  });
});

subjectFilterEl.addEventListener("change", renderBoard);
refreshButtonEl.addEventListener("click", fetchAndRender);
updateRefreshButton();
setInterval(updateRefreshButton, 60 * 1000);
fetchAndRender();
setInterval(fetchAndRender, REFRESH_INTERVAL_MS);
