# Supabase setup

This guide prepares a Supabase project for the application. It does not create the Supabase account or project for you. The public page reads from Supabase after browser configuration is filled in, and the admin login/management page is available at `/admin.html`.

## 1. Create a project

1. Create an account at [supabase.com](https://supabase.com/) and create a project.
2. Choose a project name and a region near the users. Set a strong database password and save it in a password manager; do not add it to this repository.
3. Wait for the database to finish provisioning.
4. In the project dashboard, find the project URL, publishable/anon key, and project reference. Keep the `service_role` key private.

## 2. Initialize the database

The schema is in [`supabase/migrations/20261001000000_initial_schema.sql`](supabase/migrations/20261001000000_initial_schema.sql). Choose one of these approaches:

### SQL Editor (simplest for the first setup)

1. Open **SQL Editor** in the Supabase dashboard and create a new query.
2. Copy the complete migration file into the editor and run it.
3. Check the result for errors before proceeding.

The migration creates subjects, events, admin profiles, subject assignments, public content metadata, indexes, timestamp triggers, and row-level security policies. It does not add sample records.

After the migration succeeds, configure the public page:

1. In the dashboard, open **Project Settings → API** (or **Data API**) and copy the Project URL and the publishable key. A legacy `anon` key is also accepted.
2. Put these in `/home/runner/work/bits-now-page/bits-now-page/supabase-config.js`:

   ```js
   window.SUPABASE_CONFIG = {
     url: "https://YOUR_PROJECT_REF.supabase.co",
     anonKey: "YOUR_PUBLISHABLE_OR_ANON_KEY"
   };
   ```

3. The publishable/anon key is intended to be public browser configuration; RLS must remain enabled. Never put the `service_role` key or database password in this file.
4. Deploy the static website, then open it and check that subjects/events load. If none have been entered yet, an empty board is expected. Browser developer tools can show API errors; a `401`/`403` usually indicates a URL/key or RLS/grant issue.

The page queries public subjects, non-hidden events, and the last content update. It refreshes automatically once per minute and also has a manual refresh. Favourites are saved in local browser storage and are not sent to Supabase.

### Supabase CLI (versioned workflow)

Install the Supabase CLI using its official installation instructions, then from the repository root:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Use either the SQL Editor path or `db push` for the initial migration, not both. If you ran the migration in the SQL Editor and later adopt the CLI, reconcile that version in the CLI migration history before pushing additional migrations.

## 3. Bootstrap the only super admin

1. In the dashboard, open **Authentication → Users** and create the first user with the super admin's email. Do not enable public sign-ups for the application.
2. Copy that user's ID from the user list.
3. In SQL Editor, run the following after replacing the placeholders:

```sql
insert into public.profiles (user_id, role, display_name)
values ('AUTH_USER_UUID', 'super_admin', 'Super Admin');
```

Use the UUID shown in the dashboard. The migration enforces one super-admin profile. Do not promote an admin from a browser or client application.

The profile and role are separate from the Auth password: Supabase Auth stores and verifies passwords. The migration intentionally creates no password column.

## 4. Deploy protected admin account operations

The `manage-admin` Edge Function checks the caller's Supabase Auth token and confirms the caller has the `super_admin` role before it uses the server-only service-role key. It supports listing, creating, updating, deleting, and resetting the password for admin accounts. It cannot modify or delete the super-admin account.

The function requires the exact deployed website origin as `APP_ALLOWED_ORIGIN`. Set it in Supabase's function secrets; the platform supplies the project URL and standard Supabase keys to deployed functions:

```sh
supabase secrets set APP_ALLOWED_ORIGIN=https://YOUR_SITE_ORIGIN
supabase functions deploy manage-admin
```

For local function development, use a private `.env` file with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `APP_ALLOWED_ORIGIN`; never commit that file or expose the service-role key in browser code. The function is configured to require a valid JWT at the Supabase gateway as well as checking the super-admin role itself.

Admin creation requires an email, a temporary password (12–128 characters), display name, and an array of assigned subject UUIDs. Deliver initial/reset passwords to the admin privately. Only a super admin can call these operations. Admins can edit events only for their assigned subjects; event changes and subject changes update the public `content_metadata.updated_at` value.

The function accepts JSON POST requests with the caller's bearer token:

| `action` | Required fields |
| --- | --- |
| `list` | none |
| `create` | `email`, `password`, `display_name`, `subject_ids` |
| `update` | `user_id`; optional `email`, `display_name`, `subject_ids` |
| `reset_password` | `user_id`, `password` |
| `delete` | `user_id` |

Use `subject_ids: []` to remove all subject assignments. The browser-facing admin page calls this function with the signed-in super admin's token; it never needs the service-role key. If you deployed an earlier version of this function, redeploy it after pulling the latest repository changes so it includes the `list` action.

## 5. Authentication and access rules

In **Authentication → Settings**, disable public sign-ups. Use the dashboard to create the first super admin. Admins then sign in at `/admin.html`; the page reads the profile role and only shows super-admin controls to the super admin. Configure your deployed website origin in Supabase's Auth URL settings and configure the same exact origin as `APP_ALLOWED_ORIGIN` for the Edge Function.

The public page may use the publishable/anon key only after RLS is enabled (as in this migration). It may read subjects, non-hidden events, and the latest content-update timestamp; it cannot write data. Favourites remain in local browser storage and are not sent to Supabase. A logged-in assigned admin can see hidden events and manage events for assigned subjects. Super admins can manage events for every subject. Only the protected function uses the service-role key for admin-account operations.

Admin login sessions are stored in that browser's local storage so they persist across reloads. Sign out on shared devices. Admin event start/end form values are interpreted as IST and stored as `timestamptz` instants; deleting an event permanently removes its row. Deleting a subject also permanently deletes its events because of the database foreign-key cascade.

Event `start_at` and `end_at` are PostgreSQL `timestamptz` values: they represent instants, not wall-clock strings. Pass an explicit IST offset when creating timestamps (for example `2026-10-01T09:00:00+05:30`) and format them in `Asia/Kolkata` in the UI. Event rows also retain the existing optional link field.

## 6. Backups and verification

Before using real data, test with separate public, admin, and super-admin accounts:

- Logged-out users can read subjects and visible events but cannot write.
- Hidden events are not returned to the public; assigned admins can still manage them.
- Admins cannot access or edit events for unassigned subjects.
- The super admin can manage all events, subjects, and admin accounts.
- Only the super admin can create, edit, delete, or reset admin accounts.

Do not assume a free plan includes automated backups or point-in-time recovery. Confirm current plan limits in Supabase's dashboard/docs. Keep an independent, private database export and verify that you can restore it; never place database passwords or service-role keys in backups committed to this repository.
