create table if not exists public.work_schedules (
  user_id uuid not null references public.profiles (id) on delete cascade,
  work_date date not null,
  primary key (user_id, work_date)
);

alter table public.work_schedules enable row level security;

drop policy if exists "Users view own schedules and admins view all" on public.work_schedules;
drop policy if exists "Admins create schedules" on public.work_schedules;
drop policy if exists "Admins update schedules" on public.work_schedules;
drop policy if exists "Admins delete schedules" on public.work_schedules;

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

revoke all on public.work_schedules from anon, authenticated;
grant select, insert, update, delete on public.work_schedules to authenticated;

notify pgrst, 'reload schema';
