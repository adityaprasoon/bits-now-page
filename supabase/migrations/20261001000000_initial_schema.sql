create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to anon, authenticated;

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'admin' check (role in ('admin', 'super_admin')),
  display_name text not null check (length(trim(display_name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_single_super_admin
  on public.profiles (role)
  where role = 'super_admin';

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code = trim(code) and length(code) > 0),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index subjects_code_case_insensitive
  on public.subjects (lower(trim(code)));

create table public.subject_admins (
  admin_user_id uuid not null references public.profiles (user_id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (admin_user_id, subject_id)
);

create index subject_admins_by_subject
  on public.subject_admins (subject_id, admin_user_id);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects (id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  description text not null default '',
  start_at timestamptz not null,
  end_at timestamptz not null,
  is_hidden boolean not null default false,
  link text check (link is null or link ~* '^https?://'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_end_after_start check (end_at > start_at)
);

create index events_subject_start on public.events (subject_id, start_at);
create index events_end on public.events (end_at desc);
create index events_visible_subject_start
  on public.events (subject_id, start_at)
  where is_hidden = false;

create table public.content_metadata (
  id boolean primary key default true check (id),
  updated_at timestamptz not null default now()
);

insert into public.content_metadata (id) values (true);

create or replace function app_private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role = 'super_admin'
  );
$$;

create or replace function app_private.can_manage_subject(p_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_super_admin()
    or exists (
      select 1
      from public.profiles p
      join public.subject_admins sa on sa.admin_user_id = p.user_id
      where p.user_id = auth.uid()
        and p.role = 'admin'
        and sa.subject_id = p_subject_id
    );
$$;

create or replace function public.set_admin_subjects(
  p_admin_user_id uuid,
  p_subject_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles
    where user_id = p_admin_user_id and role = 'admin'
  ) then
    raise exception 'Target user is not an admin';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_subject_ids, array[]::uuid[])) as requested(subject_id)
    left join public.subjects s on s.id = requested.subject_id
    where s.id is null
  ) then
    raise exception 'One or more subjects do not exist';
  end if;

  delete from public.subject_admins
  where admin_user_id = p_admin_user_id;

  insert into public.subject_admins (admin_user_id, subject_id)
  select p_admin_user_id, requested.subject_id
  from (
    select distinct subject_id
    from unnest(coalesce(p_subject_ids, array[]::uuid[])) as requested_ids(subject_id)
  ) as requested;
end;
$$;

revoke all on function app_private.is_super_admin() from public;
revoke all on function app_private.can_manage_subject(uuid) from public;
grant execute on function app_private.is_super_admin() to anon, authenticated;
grant execute on function app_private.can_manage_subject(uuid) to anon, authenticated;
revoke all on function public.set_admin_subjects(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.set_admin_subjects(uuid, uuid[]) to service_role;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.stamp_content_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.content_metadata
  set updated_at = now()
  where id = true;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger subjects_set_updated_at
  before update on public.subjects
  for each row execute function public.set_updated_at();

create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

create trigger subjects_stamp_content_change
  after insert or update or delete on public.subjects
  for each row execute function public.stamp_content_change();

create trigger events_stamp_content_change
  after insert or update or delete on public.events
  for each row execute function public.stamp_content_change();

alter table public.profiles enable row level security;
alter table public.subjects enable row level security;
alter table public.subject_admins enable row level security;
alter table public.events enable row level security;
alter table public.content_metadata enable row level security;

grant select on public.subjects to anon, authenticated;
grant select on public.events to anon, authenticated;
grant select (updated_at) on public.content_metadata to anon, authenticated;
grant select on public.profiles, public.subject_admins to authenticated;
grant insert, update, delete on public.subjects to authenticated;
grant insert, update, delete on public.events to authenticated;
grant all on public.profiles, public.subjects, public.subject_admins,
  public.events, public.content_metadata to service_role;

create policy "Subjects are readable by everyone"
  on public.subjects for select
  to anon, authenticated
  using (true);

create policy "Super admin can create subjects"
  on public.subjects for insert
  to authenticated
  with check (app_private.is_super_admin());

create policy "Super admin can update subjects"
  on public.subjects for update
  to authenticated
  using (app_private.is_super_admin())
  with check (app_private.is_super_admin());

create policy "Super admin can delete subjects"
  on public.subjects for delete
  to authenticated
  using (app_private.is_super_admin());

create policy "Public can read visible events; admins can read assigned events"
  on public.events for select
  to anon, authenticated
  using (
    not is_hidden
    or app_private.is_super_admin()
    or app_private.can_manage_subject(subject_id)
  );

create policy "Assigned admins and super admin can create events"
  on public.events for insert
  to authenticated
  with check (app_private.can_manage_subject(subject_id));

create policy "Assigned admins and super admin can update events"
  on public.events for update
  to authenticated
  using (app_private.can_manage_subject(subject_id))
  with check (app_private.can_manage_subject(subject_id));

create policy "Assigned admins and super admin can delete events"
  on public.events for delete
  to authenticated
  using (app_private.can_manage_subject(subject_id));

create policy "Users can read their own profile; super admin can read all"
  on public.profiles for select
  to authenticated
  using (user_id = auth.uid() or app_private.is_super_admin());

create policy "Admins can read their own assignments; super admin can read all"
  on public.subject_admins for select
  to authenticated
  using (
    admin_user_id = auth.uid()
    or app_private.is_super_admin()
  );

create policy "Last content update is public"
  on public.content_metadata for select
  to anon, authenticated
  using (true);
