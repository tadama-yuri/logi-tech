begin;

do $$
declare
  admin_user_id uuid;
begin
  select id
  into admin_user_id
  from public.profiles
  where name = 'テスト管理者：田中'
    and role = '管理者'
  limit 1;

  if admin_user_id is null then
    raise exception 'テスト管理者プロフィールが見つかりません。先にアカウントと管理者ロールを設定してください。';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = (select id from auth.users where email = 'test-driver@example.com')
      and role = 'ドライバー'
  ) then
    raise exception 'test-driver@example.com のドライバープロフィールが見つかりません。';
  end if;

  perform set_config('request.jwt.claim.sub', admin_user_id::text, true);
end;
$$;

insert into public.work_records (
  id, user_id, work_date, start_time, end_time, break_minutes, wait_minutes,
  note, created_at, status
)
select
  sample.id,
  profile.id,
  sample.work_date,
  sample.start_time,
  sample.end_time,
  sample.break_minutes,
  sample.wait_minutes,
  sample.note,
  sample.created_at,
  'pending'
from (
  values
    (
      'f6c61484-0b4b-4c79-8b5a-000000000001'::uuid,
      current_date,
      '07:30'::text,
      '17:15'::text,
      60,
      95,
      'テスト記録：午前便・午後便'::text,
      now() - interval '1 hour'
    ),
    (
      'f6c61484-0b4b-4c79-8b5a-000000000002'::uuid,
      current_date - 1,
      '08:00'::text,
      '18:00'::text,
      60,
      120,
      'テスト記録：センターで荷待ち'::text,
      now() - interval '1 day'
    ),
    (
      'f6c61484-0b4b-4c79-8b5a-000000000003'::uuid,
      current_date - 2,
      '07:00'::text,
      '16:30'::text,
      60,
      30,
      'テスト記録：荷待ち短め'::text,
      now() - interval '2 days'
    ),
    (
      'f6c61484-0b4b-4c79-8b5a-000000000004'::uuid,
      current_date - 3,
      '06:45'::text,
      '16:20'::text,
      60,
      55,
      'テスト記録：早朝便'::text,
      now() - interval '3 days'
    )
) as sample(id, work_date, start_time, end_time, break_minutes, wait_minutes, note, created_at)
join auth.users auth_user on auth_user.email = 'test-driver@example.com'
join public.profiles profile on profile.id = auth_user.id and profile.role = 'ドライバー'
on conflict (id) do nothing;

commit;
