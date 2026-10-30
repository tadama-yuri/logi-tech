create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  role text not null default 'ドライバー' check (role in ('管理者', 'ドライバー'))
);

create table public.work_records (
  id uuid primary key,
  user_id uuid not null,
  work_date date not null,
  start_time text not null,
  end_time text not null,
  break_minutes integer not null default 0 check (break_minutes >= 0),
  wait_minutes integer not null default 0 check (wait_minutes >= 0),
  note text not null default '',
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'returned')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text not null default ''
);

create table public.active_shifts (
  user_id uuid primary key,
  started_at timestamptz not null,
  start_time text not null,
  break_minutes integer not null default 0 check (break_minutes >= 0),
  wait_minutes integer not null default 0 check (wait_minutes >= 0),
  activity text check (activity in ('break', 'wait')),
  activity_started_at timestamptz
);

create table public.work_schedules (
  user_id uuid not null references public.profiles (id) on delete cascade,
  work_date date not null,
  primary key (user_id, work_date)
);

create table public.audit_log (
  id uuid primary key,
  record_id uuid not null,
  record_user_id uuid not null,
  record_user_name text not null,
  actor_id uuid not null,
  actor_name text not null,
  action text not null,
  details text not null default '',
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = '管理者'
  );
$$;

create function public.create_profile_for_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.create_profile_for_new_auth_user();

create function public.protect_work_record_review_fields()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    if tg_op = 'INSERT' then
      if new.user_id <> (select auth.uid()) or new.status <> 'pending'
        or new.reviewed_by is not null or new.reviewed_at is not null or new.review_note <> '' then
        raise exception 'Drivers may only create their own pending records';
      end if;
    elsif new.user_id <> old.user_id
      or new.status is distinct from old.status
      or new.reviewed_by is distinct from old.reviewed_by
      or new.reviewed_at is distinct from old.reviewed_at
      or new.review_note is distinct from old.review_note then
      raise exception 'Only administrators may change review fields or record ownership';
    end if;
  end if;
  return new;
end;
$$;

create trigger protect_work_record_review_fields
  before insert or update on public.work_records
  for each row execute procedure public.protect_work_record_review_fields();

create function public.write_work_record_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_user_id uuid := (select auth.uid());
  acting_user_name text;
  record_user_name text;
  old_data jsonb;
  new_data jsonb;
  event_action text;
  event_details text := '';
  target public.work_records;
begin
  select name into acting_user_name from public.profiles where id = acting_user_id;

  if tg_op = 'DELETE' then
    target := old;
    old_data := jsonb_build_object(
      'date', old.work_date, 'userId', old.user_id, 'start', old.start_time,
      'end', old.end_time, 'breakMinutes', old.break_minutes, 'waitMinutes', old.wait_minutes,
      'note', old.note, 'status', old.status, 'reviewNote', old.review_note
    );
    event_action := '勤務記録を削除';
  else
    target := new;
    if tg_op = 'UPDATE' then
      old_data := jsonb_build_object(
        'date', old.work_date, 'userId', old.user_id, 'start', old.start_time,
        'end', old.end_time, 'breakMinutes', old.break_minutes, 'waitMinutes', old.wait_minutes,
        'note', old.note, 'status', old.status, 'reviewNote', old.review_note
      );
    end if;
    new_data := jsonb_build_object(
      'date', new.work_date, 'userId', new.user_id, 'start', new.start_time,
      'end', new.end_time, 'breakMinutes', new.break_minutes, 'waitMinutes', new.wait_minutes,
      'note', new.note, 'status', new.status, 'reviewNote', new.review_note
    );
    if tg_op = 'INSERT' then
      event_action := '勤務記録を作成';
    elsif old.status is distinct from new.status and new.status = 'approved' then
      event_action := '勤務記録を承認';
    elsif old.status is distinct from new.status and new.status = 'returned' then
      event_action := '勤務記録を差し戻し';
      event_details := '差し戻し理由: ' || new.review_note;
    else
      event_action := '勤務記録を編集';
    end if;
  end if;

  select name into record_user_name from public.profiles where id = target.user_id;
  insert into public.audit_log (
    id, record_id, record_user_id, record_user_name, actor_id, actor_name,
    action, details, before_data, after_data
  )
  values (
    gen_random_uuid(), target.id, target.user_id,
    coalesce(record_user_name, '削除済みユーザー'),
    acting_user_id, coalesce(acting_user_name, '不明なユーザー'),
    event_action, event_details, old_data, new_data
  );
  return target;
end;
$$;

create trigger audit_work_record_changes
  after insert or update or delete on public.work_records
  for each row execute procedure public.write_work_record_audit();

alter table public.profiles enable row level security;
alter table public.work_records enable row level security;
alter table public.active_shifts enable row level security;
alter table public.work_schedules enable row level security;
alter table public.audit_log enable row level security;

create policy "Authenticated users can view team profiles"
  on public.profiles for select to authenticated using (true);

create policy "Users view own records and admins view all"
  on public.work_records for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_app_admin()));
create policy "Users create own records and admins create any"
  on public.work_records for insert to authenticated
  with check (user_id = (select auth.uid()) or (select public.is_app_admin()));
create policy "Users update own records and admins update any"
  on public.work_records for update to authenticated
  using (user_id = (select auth.uid()) or (select public.is_app_admin()))
  with check (user_id = (select auth.uid()) or (select public.is_app_admin()));
create policy "Users delete own records and admins delete any"
  on public.work_records for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.is_app_admin()));

create policy "Users view own shifts and admins view all"
  on public.active_shifts for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_app_admin()));
create policy "Users create own shifts and admins create any"
  on public.active_shifts for insert to authenticated
  with check (user_id = (select auth.uid()) or (select public.is_app_admin()));
create policy "Users update own shifts and admins update any"
  on public.active_shifts for update to authenticated
  using (user_id = (select auth.uid()) or (select public.is_app_admin()))
  with check (user_id = (select auth.uid()) or (select public.is_app_admin()));
create policy "Users delete own shifts and admins delete any"
  on public.active_shifts for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.is_app_admin()));

create policy "Users view own schedules and admins view all"
  on public.work_schedules for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_app_admin()));
create policy "Admins create schedules"
  on public.work_schedules for insert to authenticated
  with check ((select public.is_app_admin()));
create policy "Admins update schedules"
  on public.work_schedules for update to authenticated
  using ((select public.is_app_admin()))
  with check ((select public.is_app_admin()));
create policy "Admins delete schedules"
  on public.work_schedules for delete to authenticated
  using ((select public.is_app_admin()));

create policy "Users view own audit history and admins view all"
  on public.audit_log for select to authenticated
  using (record_user_id = (select auth.uid()) or (select public.is_app_admin()));

grant usage on schema public to authenticated;
revoke all on public.profiles, public.work_records, public.active_shifts, public.work_schedules, public.audit_log from anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.work_records to authenticated;
grant select, insert, update, delete on public.active_shifts to authenticated;
grant select, insert, update, delete on public.work_schedules to authenticated;
grant select on public.audit_log to authenticated;
revoke all on function public.is_app_admin() from public, anon;
grant execute on function public.is_app_admin() to authenticated;
revoke all on function public.write_work_record_audit() from public, anon, authenticated;
revoke all on function public.protect_work_record_review_fields() from public, anon, authenticated;
revoke all on function public.create_profile_for_new_auth_user() from public, anon, authenticated;

create function public.save_app_changes(
  p_records_upsert jsonb,
  p_deleted_record_ids uuid[],
  p_shifts_upsert jsonb,
  p_deleted_shift_user_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from public.work_records where id = any(p_deleted_record_ids);

  insert into public.work_records (
    id, user_id, work_date, start_time, end_time, break_minutes, wait_minutes,
    note, created_at, status, reviewed_by, reviewed_at, review_note
  )
  select id, user_id, work_date, start_time, end_time, break_minutes, wait_minutes,
    note, created_at, status, reviewed_by, reviewed_at, review_note
  from jsonb_to_recordset(p_records_upsert) as item(
    id uuid, user_id uuid, work_date date, start_time text, end_time text,
    break_minutes integer, wait_minutes integer, note text, created_at timestamptz,
    status text, reviewed_by uuid, reviewed_at timestamptz, review_note text
  )
  on conflict (id) do update set
    user_id = excluded.user_id,
    work_date = excluded.work_date,
    start_time = excluded.start_time,
    end_time = excluded.end_time,
    break_minutes = excluded.break_minutes,
    wait_minutes = excluded.wait_minutes,
    note = excluded.note,
    created_at = excluded.created_at,
    status = excluded.status,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at,
    review_note = excluded.review_note;

  delete from public.active_shifts where user_id = any(p_deleted_shift_user_ids);

  insert into public.active_shifts (
    user_id, started_at, start_time, break_minutes, wait_minutes, activity, activity_started_at
  )
  select user_id, started_at, start_time, break_minutes, wait_minutes, activity, activity_started_at
  from jsonb_to_recordset(p_shifts_upsert) as item(
    user_id uuid, started_at timestamptz, start_time text, break_minutes integer,
    wait_minutes integer, activity text, activity_started_at timestamptz
  )
  on conflict (user_id) do update set
    started_at = excluded.started_at,
    start_time = excluded.start_time,
    break_minutes = excluded.break_minutes,
    wait_minutes = excluded.wait_minutes,
    activity = excluded.activity,
    activity_started_at = excluded.activity_started_at;

end;
$$;

revoke all on function public.save_app_changes(jsonb, uuid[], jsonb, uuid[]) from public, anon;
grant execute on function public.save_app_changes(jsonb, uuid[], jsonb, uuid[]) to authenticated;
