const supabaseUrl = Deno.env.get("SUPABASE_URL");
const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const allowedOrigin = Deno.env.get("APP_ALLOWED_ORIGIN");

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {})
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders
  });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isEmail(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 12 && value.length <= 128;
}

function isSubjectIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isUuid);
}

function serviceHeaders(extra: Record<string, string> = {}) {
  return {
    apikey: serviceRoleKey!,
    Authorization: "Bearer " + serviceRoleKey,
    "Content-Type": "application/json",
    ...extra
  };
}

async function checkResponse(response: Response) {
  if (!response.ok) {
    throw new Error("Supabase request failed");
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function getAdminProfile(userId: string) {
  const query = new URLSearchParams({
    select: "user_id,role",
    user_id: `eq.${userId}`
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/profiles?${query}`, {
    headers: serviceHeaders()
  });
  const rows = await checkResponse(response);
  return Array.isArray(rows) && rows[0]?.role === "admin" ? rows[0] : null;
}

async function setAssignments(userId: string, subjectIds: string[]) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/set_admin_subjects`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      p_admin_user_id: userId,
      p_subject_ids: subjectIds
    })
  });
  await checkResponse(response);
}

async function deleteAuthUser(userId: string) {
  const response = await fetch(
    `${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    { method: "DELETE", headers: serviceHeaders() }
  );
  await checkResponse(response);
}

async function handleCreate(body: Record<string, unknown>) {
  const { email, password, display_name: displayName, subject_ids: subjectIds } = body;
  if (
    !isEmail(email)
    || !validPassword(password)
    || typeof displayName !== "string"
    || !displayName.trim()
    || displayName.length > 120
    || !isSubjectIdList(subjectIds)
  ) {
    return jsonResponse(400, { error: "Invalid admin details." });
  }

  const createResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName.trim() }
    })
  });
  const user = await checkResponse(createResponse);

  try {
    const profileResponse = await fetch(`${supabaseUrl}/rest/v1/profiles`, {
      method: "POST",
      headers: serviceHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({
        user_id: user.id,
        role: "admin",
        display_name: displayName.trim()
      })
    });
    await checkResponse(profileResponse);
    await setAssignments(user.id, subjectIds);
  } catch (error) {
    await deleteAuthUser(user.id);
    throw error;
  }

  return jsonResponse(201, { user_id: user.id });
}

async function handleList() {
  const profileQuery = new URLSearchParams({
    select: "user_id,display_name,created_at",
    role: "eq.admin",
    order: "display_name.asc"
  });
  const [profileResponse, userResponse, assignmentResponse] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/profiles?${profileQuery}`, {
      headers: serviceHeaders()
    }),
    fetch(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1000`, {
      headers: serviceHeaders()
    }),
    fetch(`${supabaseUrl}/rest/v1/subject_admins?select=admin_user_id,subject_id`, {
      headers: serviceHeaders()
    })
  ]);
  const [adminProfiles, authUsers, assignments] = await Promise.all([
    checkResponse(profileResponse),
    checkResponse(userResponse),
    checkResponse(assignmentResponse)
  ]);
  const emailByUserId = new Map(
    (authUsers.users || []).map((user: { id: string; email?: string }) => [user.id, user.email || ""])
  );
  const subjectsByUserId = new Map<string, string[]>();
  for (const assignment of assignments) {
    const subjectIds = subjectsByUserId.get(assignment.admin_user_id) || [];
    subjectIds.push(assignment.subject_id);
    subjectsByUserId.set(assignment.admin_user_id, subjectIds);
  }

  return jsonResponse(200, {
    admins: adminProfiles.map((admin: {
      user_id: string;
      display_name: string;
      created_at: string;
    }) => ({
      user_id: admin.user_id,
      email: emailByUserId.get(admin.user_id) || "",
      display_name: admin.display_name,
      created_at: admin.created_at,
      subject_ids: subjectsByUserId.get(admin.user_id) || []
    }))
  });
}

async function handleUpdate(body: Record<string, unknown>, userId: string) {
  const profile = await getAdminProfile(userId);
  if (!profile) {
    return jsonResponse(404, { error: "Admin account not found." });
  }

  const {
    email,
    display_name: displayName,
    subject_ids: subjectIds
  } = body;
  if (
    (email !== undefined && !isEmail(email))
    || (displayName !== undefined
      && (typeof displayName !== "string" || !displayName.trim() || displayName.length > 120))
    || (subjectIds !== undefined && !isSubjectIdList(subjectIds))
  ) {
    return jsonResponse(400, { error: "Invalid admin details." });
  }

  if (email !== undefined) {
    const authResponse = await fetch(
      `${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
      {
        method: "PUT",
        headers: serviceHeaders(),
        body: JSON.stringify({ email, email_confirm: true })
      }
    );
    await checkResponse(authResponse);
  }

  if (displayName !== undefined) {
    const profileResponse = await fetch(
      `${supabaseUrl}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        headers: serviceHeaders({ Prefer: "return=minimal" }),
        body: JSON.stringify({ display_name: displayName.trim() })
      }
    );
    await checkResponse(profileResponse);
  }

  if (subjectIds !== undefined) {
    await setAssignments(userId, subjectIds);
  }

  return jsonResponse(200, { user_id: userId });
}

async function handleResetPassword(body: Record<string, unknown>, userId: string) {
  if (!validPassword(body.password)) {
    return jsonResponse(400, { error: "Password must be 12–128 characters." });
  }
  if (!await getAdminProfile(userId)) {
    return jsonResponse(404, { error: "Admin account not found." });
  }

  const response = await fetch(
    `${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    {
      method: "PUT",
      headers: serviceHeaders(),
      body: JSON.stringify({ password: body.password })
    }
  );
  await checkResponse(response);
  return jsonResponse(200, { user_id: userId });
}

async function handleDelete(userId: string) {
  if (!await getAdminProfile(userId)) {
    return jsonResponse(404, { error: "Admin account not found." });
  }
  await deleteAuthUser(userId);
  return jsonResponse(200, { user_id: userId });
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !allowedOrigin) {
    return jsonResponse(500, { error: "Admin service is not configured." });
  }
  if (origin && origin !== allowedOrigin) {
    return jsonResponse(403, { error: "Origin not allowed." });
  }
  if (request.method === "OPTIONS") {
    return origin === allowedOrigin
      ? new Response("ok", { headers: corsHeaders })
      : jsonResponse(403, { error: "Origin not allowed." });
  }
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse(401, { error: "Authentication required." });
  }

  try {
    const authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: anonKey,
        Authorization: authorization
      }
    });
    if (!authResponse.ok) {
      return jsonResponse(401, { error: "Authentication required." });
    }
    const caller = await authResponse.json();
    const callerProfile = await fetch(
      `${supabaseUrl}/rest/v1/profiles?${new URLSearchParams({
        select: "role",
        user_id: `eq.${caller.id}`
      })}`,
      { headers: serviceHeaders() }
    );
    const profiles = await checkResponse(callerProfile);
    if (!Array.isArray(profiles) || profiles[0]?.role !== "super_admin") {
      return jsonResponse(403, { error: "Super admin access required." });
    }

    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonResponse(400, { error: "Invalid request body." });
    }
    switch (body.action) {
      case "list":
        return await handleList();
      case "create":
        return await handleCreate(body);
      case "update":
        return isUuid(body.user_id)
          ? await handleUpdate(body, body.user_id)
          : jsonResponse(400, { error: "Invalid admin user id." });
      case "reset_password":
        return isUuid(body.user_id)
          ? await handleResetPassword(body, body.user_id)
          : jsonResponse(400, { error: "Invalid admin user id." });
      case "delete":
        return isUuid(body.user_id)
          ? await handleDelete(body.user_id)
          : jsonResponse(400, { error: "Invalid admin user id." });
      default:
        return jsonResponse(400, { error: "Unsupported admin action." });
    }
  } catch {
    return jsonResponse(500, { error: "Unable to complete the admin operation." });
  }
});
