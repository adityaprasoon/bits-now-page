const SUPABASE_URL = (window.SUPABASE_CONFIG?.url || "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = window.SUPABASE_CONFIG?.anonKey || "";
const SESSION_KEY = "now-page-admin-session";
const IST_OFFSET_MINUTES = 330;

const loginPanel = document.getElementById("login-panel");
const adminPanel = document.getElementById("admin-panel");
const loginForm = document.getElementById("login-form");
const messageEl = document.getElementById("admin-message");
const successEl = document.getElementById("admin-success");
const eventForm = document.getElementById("event-form");
const eventList = document.getElementById("admin-events");
const recordSubjectOptions = document.getElementById("record-subject-options");
const subjectForm = document.getElementById("subject-form");
const subjectList = document.getElementById("admin-subjects");
const createAdminForm = document.getElementById("create-admin-form");
const adminUsersList = document.getElementById("admin-users");

let session = loadSession();
let profile = null;
let subjects = [];
let assignedSubjectIds = [];
let eventRecords = [];
let adminRecords = [];
const excludedRecordSubjectIds = new Set();

function loadSession() {
  try {
    const value = localStorage.getItem(SESSION_KEY);
    return value ? JSON.parse(value) : null;
  } catch (_err) {
    return null;
  }
}

function saveSession(value) {
  session = value;
  try {
    if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value));
    else localStorage.removeItem(SESSION_KEY);
  } catch (_err) {
    showError("Could not save your sign-in session in this browser.");
  }
}

function showError(message) {
  messageEl.textContent = message;
  messageEl.classList.remove("hidden");
  successEl.classList.add("hidden");
}

function showSuccess(message) {
  successEl.textContent = message;
  successEl.classList.remove("hidden");
  messageEl.classList.add("hidden");
}

function clearMessages() {
  messageEl.textContent = "";
  successEl.textContent = "";
  messageEl.classList.add("hidden");
  successEl.classList.add("hidden");
}

async function readResponse(response) {
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_err) {
      data = null;
    }
  }
  if (!response.ok) {
    const message = data?.msg || data?.message || data?.error_description || data?.error;
    throw new Error(message || `Request failed (${response.status}).`);
  }
  return data;
}

async function authRequest(path, body) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return readResponse(response);
}

async function refreshSession() {
  if (!session?.refresh_token) {
    saveSession(null);
    throw new Error("Your session expired. Please sign in again.");
  }
  try {
    const refreshed = await authRequest("token?grant_type=refresh_token", {
      refresh_token: session.refresh_token
    });
    saveSession({
      ...refreshed,
      expires_at: refreshed.expires_at || Math.floor(Date.now() / 1000) + refreshed.expires_in
    });
    return session;
  } catch (_err) {
    saveSession(null);
    throw new Error("Your session expired. Please sign in again.");
  }
}

async function authenticatedFetch(path, options = {}, retry = true) {
  if (!session?.access_token) {
    throw new Error("Please sign in to continue.");
  }
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: "Bearer " + session.access_token,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  if (response.status === 401 && retry) {
    await refreshSession();
    return authenticatedFetch(path, options, false);
  }
  return readResponse(response);
}

function restPath(table, params = {}) {
  const query = new URLSearchParams(params);
  return `/rest/v1/${table}?${query}`;
}

async function dbRequest(table, params = {}, method = "GET", body = undefined) {
  return authenticatedFetch(restPath(table, params), {
    method,
    ...(body === undefined ? {} : {
      body: JSON.stringify(body),
      headers: { Prefer: method === "POST" ? "return=representation" : "return=minimal" }
    })
  });
}

async function edgeRequest(body) {
  return authenticatedFetch("/functions/v1/manage-admin", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

function localIstToIso(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value || "");
  if (!match) throw new Error("Enter both event dates and times in IST.");
  const [, year, month, day, hour, minute] = match.map(Number);
  const wallClock = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    wallClock.getUTCFullYear() !== year
    || wallClock.getUTCMonth() !== month - 1
    || wallClock.getUTCDate() !== day
    || wallClock.getUTCHours() !== hour
    || wallClock.getUTCMinutes() !== minute
  ) {
    throw new Error("Invalid event date or time.");
  }
  return new Date(wallClock.getTime() - IST_OFFSET_MINUTES * 60 * 1000).toISOString();
}

function isoToLocalIst(isoDateTime) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(isoDateTime));
  const result = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${result.year}-${result.month}-${result.day}T${result.hour}:${result.minute}`;
}

function formatIst(isoDateTime) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  }).format(new Date(isoDateTime)) + " IST";
}

function addText(parent, tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function makeButton(text, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.addEventListener("click", onClick);
  return button;
}

function makeField(labelText, value, type = "text") {
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = type;
  input.value = value || "";
  if (type === "password") {
    input.minLength = 7;
    input.autocomplete = "new-password";
  }
  label.append(input);
  return { label, input };
}

function selectedCheckboxIds(container) {
  return Array.from(
    container.querySelectorAll('input[type="checkbox"]:checked'),
    (input) => input.value
  );
}

function renderAssignmentCheckboxes(container, checkedIds = []) {
  const selected = new Set(checkedIds);
  container.replaceChildren();
  subjects.forEach((subject) => {
    const label = document.createElement("label");
    label.className = "assignment-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = subject.id;
    checkbox.checked = selected.has(subject.id);
    const text = document.createElement("span");
    text.textContent = `${subject.code} · ${subject.name}`;
    label.append(checkbox, text);
    container.append(label);
  });
  if (!subjects.length) addText(container, "p", "empty", "Create subjects before assigning them.");
}

async function loadCurrentUser() {
  const response = await authenticatedFetch("/auth/v1/user");
  const rows = await dbRequest("profiles", {
    select: "role,display_name",
    user_id: `eq.${response.id}`
  });
  if (!rows.length || !["admin", "super_admin"].includes(rows[0].role)) {
    saveSession(null);
    throw new Error("This account does not have an admin profile.");
  }
  profile = rows[0];
  document.getElementById("admin-identity").textContent =
    `${profile.display_name} · ${profile.role === "super_admin" ? "Super admin" : "Admin"}`;
  loginPanel.classList.add("hidden");
  adminPanel.classList.remove("hidden");
  document.getElementById("subject-admin-section").classList.toggle("hidden", profile.role !== "super_admin");
  document.getElementById("admin-users-section").classList.toggle("hidden", profile.role !== "super_admin");
  await loadAdminData();
}

async function loadAdminData() {
  clearMessages();
  const [subjectRows, assignmentRows, rows] = await Promise.all([
    dbRequest("subjects", { select: "id,code,name", order: "code.asc" }),
    profile.role === "super_admin"
      ? Promise.resolve([])
      : dbRequest("subject_admins", {
        select: "subject_id",
        admin_user_id: `eq.${session.user.id}`
      }),
    dbRequest("events", {
      select: "id,subject_id,title,description,start_at,end_at,is_hidden,link,subjects(code,name)",
      order: "start_at.desc"
    })
  ]);
  subjects = subjectRows;
  assignedSubjectIds = profile.role === "super_admin"
    ? subjects.map((subject) => subject.id)
    : assignmentRows.map((assignment) => assignment.subject_id);
  eventRecords = rows.map((event) => ({
    ...event,
    subject: Array.isArray(event.subjects) ? event.subjects[0] : event.subjects
  }));
  renderEventSubjectOptions();
  renderRecordSubjectFilter();
  renderEvents();

  if (profile.role === "super_admin") {
    renderSubjects();
    renderAssignmentCheckboxes(document.getElementById("new-admin-subjects"));
    await loadAdminAccounts();
  }
}

function renderEventSubjectOptions() {
  const select = document.getElementById("event-subject");
  select.replaceChildren();
  subjects
    .filter((subject) => assignedSubjectIds.includes(subject.id))
    .forEach((subject) => select.add(new Option(`${subject.code} · ${subject.name}`, subject.id)));
  select.disabled = !select.options.length;
}

function renderRecordSubjectFilter() {
  recordSubjectOptions.replaceChildren();
  subjects.forEach((subject) => {
    const label = document.createElement("label");
    label.className = "record-subject-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = subject.id;
    checkbox.checked = !excludedRecordSubjectIds.has(subject.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) excludedRecordSubjectIds.delete(subject.id);
      else excludedRecordSubjectIds.add(subject.id);
      renderEvents();
    });
    const text = document.createElement("span");
    text.textContent = subject.code;
    label.append(checkbox, text);
    recordSubjectOptions.append(label);
  });
  if (!subjects.length) addText(recordSubjectOptions, "p", "empty", "No subjects available.");
}

document.getElementById("select-all-record-subjects").addEventListener("click", () => {
  excludedRecordSubjectIds.clear();
  renderRecordSubjectFilter();
  renderEvents();
});

document.getElementById("unselect-all-record-subjects").addEventListener("click", () => {
  subjects.forEach((subject) => excludedRecordSubjectIds.add(subject.id));
  renderRecordSubjectFilter();
  renderEvents();
});

function renderEvents() {
  eventList.replaceChildren();
  if (!eventRecords.length) {
    addText(eventList, "p", "empty", "No events are available for your account.");
    return;
  }
  const visibleRecords = eventRecords.filter((event) => !excludedRecordSubjectIds.has(event.subject_id));
  if (!visibleRecords.length) {
    addText(eventList, "p", "empty", "No events match the selected subjects.");
    return;
  }
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
  visibleRecords.forEach((event) => {
    const row = document.createElement("article");
    row.className = "admin-record";
    const heading = document.createElement("div");
    heading.className = "admin-record-copy";
    const subject = subjectById.get(event.subject_id) || event.subject || {};
    addText(heading, "strong", "record-subject", `${subject.code || "Subject"} · ${subject.name || ""}`);
    addText(heading, "h3", "", event.title);
    addText(
      heading,
      "p",
      "record-meta",
      `${formatIst(event.start_at)} – ${formatIst(event.end_at)}${event.is_hidden ? " · Hidden" : ""}`
    );
    row.append(heading);
    const actions = document.createElement("div");
    actions.className = "admin-record-actions";
    if (assignedSubjectIds.includes(event.subject_id)) {
      actions.append(makeButton("Edit", "secondary-button", () => beginEditEvent(event)));
      actions.append(makeButton("Delete", "danger-button", () => deleteEvent(event)));
    }
    row.append(actions);
    eventList.append(row);
  });
}

function beginEditEvent(event) {
  document.getElementById("event-id").value = event.id;
  document.getElementById("event-subject").value = event.subject_id;
  document.getElementById("event-title").value = event.title;
  document.getElementById("event-description").value = event.description || "";
  document.getElementById("event-start").value = isoToLocalIst(event.start_at);
  document.getElementById("event-end").value = isoToLocalIst(event.end_at);
  document.getElementById("event-link").value = event.link || "";
  document.getElementById("event-hidden").checked = Boolean(event.is_hidden);
  document.getElementById("event-form-heading").textContent = "Edit event";
  document.getElementById("save-event").textContent = "Save changes";
  document.getElementById("cancel-event-edit").classList.remove("hidden");
  document.getElementById("event-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetEventForm() {
  eventForm.reset();
  document.getElementById("event-id").value = "";
  document.getElementById("event-form-heading").textContent = "Add event";
  document.getElementById("save-event").textContent = "Save event";
  document.getElementById("cancel-event-edit").classList.add("hidden");
}

async function saveEvent(event) {
  event.preventDefault();
  clearMessages();
  const subjectId = document.getElementById("event-subject").value;
  if (!assignedSubjectIds.includes(subjectId)) {
    showError("You cannot manage events for that subject.");
    return;
  }

  const startAt = localIstToIso(document.getElementById("event-start").value);
  const endAt = localIstToIso(document.getElementById("event-end").value);
  if (new Date(endAt) <= new Date(startAt)) {
    showError("The event end time must be after its start time.");
    return;
  }
  const link = document.getElementById("event-link").value.trim();
  if (link && !["https:", "http:"].includes(new URL(link).protocol)) {
    showError("Event links must use http or https.");
    return;
  }

  const data = {
    subject_id: subjectId,
    title: document.getElementById("event-title").value.trim(),
    description: document.getElementById("event-description").value.trim(),
    start_at: startAt,
    end_at: endAt,
    is_hidden: document.getElementById("event-hidden").checked,
    link: link || null
  };
  const eventId = document.getElementById("event-id").value;
  if (eventId) {
    await dbRequest("events", { id: `eq.${eventId}` }, "PATCH", data);
    showSuccess("Event updated.");
  } else {
    await dbRequest("events", {}, "POST", data);
    showSuccess("Event created.");
  }
  resetEventForm();
  await loadAdminData();
}

async function deleteEvent(event) {
  if (!confirm(`Permanently delete “${event.title}”? This cannot be undone.`)) return;
  try {
    await dbRequest("events", { id: `eq.${event.id}` }, "DELETE");
    showSuccess("Event permanently deleted.");
    await loadAdminData();
  } catch (error) {
    showError(error.message);
  }
}

function renderSubjects() {
  subjectList.replaceChildren();
  subjects.forEach((subject) => {
    const row = document.createElement("article");
    row.className = "admin-record";
    const copy = document.createElement("div");
    copy.className = "admin-record-copy";
    addText(copy, "strong", "record-subject", subject.code);
    addText(copy, "h3", "", subject.name);
    row.append(copy);
    const actions = document.createElement("div");
    actions.className = "admin-record-actions";
    actions.append(makeButton("Edit", "secondary-button", () => beginEditSubject(subject)));
    actions.append(makeButton("Delete", "danger-button", () => deleteSubject(subject)));
    row.append(actions);
    subjectList.append(row);
  });
}

function beginEditSubject(subject) {
  document.getElementById("subject-id").value = subject.id;
  document.getElementById("subject-code").value = subject.code;
  document.getElementById("subject-name").value = subject.name;
  document.getElementById("cancel-subject-edit").classList.remove("hidden");
  subjectForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetSubjectForm() {
  subjectForm.reset();
  document.getElementById("subject-id").value = "";
  document.getElementById("cancel-subject-edit").classList.add("hidden");
}

async function saveSubject(event) {
  event.preventDefault();
  clearMessages();
  const id = document.getElementById("subject-id").value;
  const data = {
    code: document.getElementById("subject-code").value.trim(),
    name: document.getElementById("subject-name").value.trim()
  };
  await dbRequest(
    "subjects",
    id ? { id: `eq.${id}` } : {},
    id ? "PATCH" : "POST",
    data
  );
  resetSubjectForm();
  showSuccess(id ? "Subject updated." : "Subject created.");
  await loadAdminData();
}

async function deleteSubject(subject) {
  const confirmed = confirm(
    `Permanently delete subject “${subject.code} · ${subject.name}” and ALL its events? This cannot be undone.`
  );
  if (!confirmed) return;
  try {
    await dbRequest("subjects", { id: `eq.${subject.id}` }, "DELETE");
    showSuccess("Subject and its events permanently deleted.");
    await loadAdminData();
  } catch (error) {
    showError(error.message);
  }
}

async function loadAdminAccounts() {
  const result = await edgeRequest({ action: "list" });
  adminRecords = Array.isArray(result.admins) ? result.admins : [];
  renderAdminAccounts();
}

function renderAdminAccounts() {
  adminUsersList.replaceChildren();
  if (!adminRecords.length) {
    addText(adminUsersList, "p", "empty", "No admin accounts yet.");
    return;
  }
  adminRecords.forEach((admin) => {
    const row = document.createElement("article");
    row.className = "admin-record admin-user-record";
    const editor = document.createElement("div");
    editor.className = "admin-user-editor";
    const email = makeField("Email", admin.email, "email");
    const displayName = makeField("Display name", admin.display_name);
    editor.append(email.label, displayName.label);
    const assignmentBox = document.createElement("fieldset");
    assignmentBox.className = "assignment-fieldset";
    renderAssignmentCheckboxes(assignmentBox, admin.subject_ids || []);
    const assignmentLegend = document.createElement("legend");
    assignmentLegend.textContent = "Assigned subjects";
    assignmentBox.prepend(assignmentLegend);
    editor.append(assignmentBox);
    const password = makeField("Set a new temporary password to reset", "", "password");
    editor.append(password.label);

    const actions = document.createElement("div");
    actions.className = "admin-record-actions";
    actions.append(makeButton("Save admin", "secondary-button", async () => {
      try {
        await edgeRequest({
          action: "update",
          user_id: admin.user_id,
          email: email.input.value.trim(),
          display_name: displayName.input.value.trim(),
          subject_ids: selectedCheckboxIds(assignmentBox)
        });
        showSuccess("Admin account updated.");
        await loadAdminAccounts();
      } catch (error) {
        showError(error.message);
      }
    }));
    actions.append(makeButton("Reset password", "secondary-button", async () => {
      try {
        if (!password.input.value) throw new Error("Enter a temporary password first.");
        await edgeRequest({
          action: "reset_password",
          user_id: admin.user_id,
          password: password.input.value
        });
        password.input.value = "";
        showSuccess("Admin password reset. Share the temporary password privately.");
      } catch (error) {
        showError(error.message);
      }
    }));
    actions.append(makeButton("Delete admin", "danger-button", async () => {
      if (!confirm(`Permanently delete the admin account for ${admin.email}?`)) return;
      try {
        await edgeRequest({ action: "delete", user_id: admin.user_id });
        showSuccess("Admin account deleted.");
        await loadAdminAccounts();
      } catch (error) {
        showError(error.message);
      }
    }));
    row.append(editor, actions);
    adminUsersList.append(row);
  });
}

async function createAdmin(event) {
  event.preventDefault();
  clearMessages();
  await edgeRequest({
    action: "create",
    email: document.getElementById("new-admin-email").value.trim(),
    display_name: document.getElementById("new-admin-name").value.trim(),
    password: document.getElementById("new-admin-password").value,
    subject_ids: selectedCheckboxIds(document.getElementById("new-admin-subjects"))
  });
  createAdminForm.reset();
  showSuccess("Admin account created. Share its temporary password privately.");
  await loadAdminAccounts();
}

async function signIn(event) {
  event.preventDefault();
  clearMessages();
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    showError("Add the Supabase URL and publishable key to supabase-config.js first.");
    return;
  }
  try {
    const auth = await authRequest("token?grant_type=password", {
      email: document.getElementById("login-email").value.trim(),
      password: document.getElementById("login-password").value
    });
    saveSession({
      ...auth,
      expires_at: auth.expires_at || Math.floor(Date.now() / 1000) + auth.expires_in
    });
    document.getElementById("login-password").value = "";
    await loadCurrentUser();
    showSuccess("Signed in.");
  } catch (error) {
    saveSession(null);
    loginPanel.classList.remove("hidden");
    adminPanel.classList.add("hidden");
    showError(error.message || "Sign-in failed.");
  }
}

async function restoreSession() {
  if (!session || !SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  try {
    if (session.expires_at && session.expires_at <= Math.floor(Date.now() / 1000)) {
      await refreshSession();
    }
    await loadCurrentUser();
  } catch (error) {
    saveSession(null);
    loginPanel.classList.remove("hidden");
    adminPanel.classList.add("hidden");
    showError(error.message);
  }
}

loginForm.addEventListener("submit", signIn);
document.getElementById("sign-out").addEventListener("click", () => {
  authenticatedFetch("/auth/v1/logout", { method: "POST" }).catch(() => {});
  saveSession(null);
  profile = null;
  loginPanel.classList.remove("hidden");
  adminPanel.classList.add("hidden");
  clearMessages();
});
eventForm.addEventListener("submit", (event) => {
  saveEvent(event).catch((error) => showError(error.message));
});
document.getElementById("cancel-event-edit").addEventListener("click", resetEventForm);
document.getElementById("reload-admin-data").addEventListener("click", () => {
  loadAdminData().catch((error) => showError(error.message));
});
subjectForm.addEventListener("submit", (event) => {
  saveSubject(event).catch((error) => showError(error.message));
});
document.getElementById("cancel-subject-edit").addEventListener("click", resetSubjectForm);
createAdminForm.addEventListener("submit", (event) => {
  createAdmin(event).catch((error) => showError(error.message));
});

if (!session) loginPanel.classList.remove("hidden");
restoreSession();
