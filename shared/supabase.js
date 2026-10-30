import { SUPABASE_ANON_KEY, SUPABASE_URL } from './supabase-config.js';

let clientPromise;
let baseline;
let saveQueue = Promise.resolve();

export function getSupabaseClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase の URL と anon key を shared/supabase-config.js に設定してください。');
  }
  if (!clientPromise) {
    clientPromise = import('https://esm.sh/@supabase/supabase-js@2')
      .then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  }
  return clientPromise;
}

function throwIfError({ error }) {
  if (error) throw error;
}

function recordFromDatabase(row) {
  return {
    id: row.id,
    userId: row.user_id,
    date: row.work_date,
    start: row.start_time,
    end: row.end_time,
    breakMinutes: row.break_minutes,
    waitMinutes: row.wait_minutes,
    note: row.note || '',
    createdAt: new Date(row.created_at).getTime(),
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note || ''
  };
}

function shiftFromDatabase(row) {
  return {
    userId: row.user_id,
    startedAt: row.started_at,
    start: row.start_time,
    breakMinutes: row.break_minutes,
    waitMinutes: row.wait_minutes,
    activity: row.activity,
    activityStartedAt: row.activity_started_at
  };
}

function auditFromDatabase(row) {
  return {
    id: row.id,
    recordId: row.record_id,
    recordUserId: row.record_user_id,
    recordUserName: row.record_user_name,
    actorId: row.actor_id,
    actorName: row.actor_name,
    action: row.action,
    details: row.details || '',
    before: row.before_data,
    after: row.after_data,
    createdAt: row.created_at
  };
}

export async function loadRemoteState() {
  const client = await getSupabaseClient();
  const [users, records, shifts, auditLog, schedules] = await Promise.all([
    client.from('profiles').select('id,name,role').order('name'),
    client.from('work_records').select('*').order('work_date', { ascending: false }),
    client.from('active_shifts').select('*'),
    client.from('audit_log').select('*').order('created_at', { ascending: false }),
    client.from('work_schedules').select('user_id,work_date').order('work_date')
  ]);
  [users, records, shifts, auditLog].forEach(throwIfError);

  const missingScheduleTable = schedules.error?.code === 'PGRST205'
    && schedules.error.message.includes("public.work_schedules");
  if (schedules.error && !missingScheduleTable) throw schedules.error;
  if (missingScheduleTable) {
    console.warn('勤務予定テーブルが見つかりません。勤務予定のリマインダーを有効にするには supabase/schedule-migration.sql を実行してください。');
  }

  const state = {
    users: users.data,
    records: records.data.map(recordFromDatabase),
    activeShifts: shifts.data.map(shiftFromDatabase),
    workSchedulesAvailable: !missingScheduleTable,
    workSchedules: (schedules.data || []).map((schedule) => ({
      userId: schedule.user_id,
      date: schedule.work_date
    })),
    auditLog: auditLog.data.map(auditFromDatabase)
  };
  baseline = structuredClone(state);
  return state;
}

function recordToDatabase(record) {
  return {
    id: record.id,
    user_id: record.userId,
    work_date: record.date,
    start_time: record.start,
    end_time: record.end,
    break_minutes: Number(record.breakMinutes || 0),
    wait_minutes: Number(record.waitMinutes || 0),
    note: record.note || '',
    created_at: new Date(record.createdAt).toISOString(),
    status: record.status || 'pending',
    reviewed_by: record.reviewedBy || null,
    reviewed_at: record.reviewedAt || null,
    review_note: record.reviewNote || ''
  };
}

function shiftToDatabase(shift) {
  return {
    user_id: shift.userId,
    started_at: shift.startedAt,
    start_time: shift.start,
    break_minutes: Number(shift.breakMinutes || 0),
    wait_minutes: Number(shift.waitMinutes || 0),
    activity: shift.activity || null,
    activity_started_at: shift.activityStartedAt || null
  };
}

function changedRows(previous = [], current = [], toRow) {
  const previousById = new Map(previous.map((row) => [row.id || row.userId, row]));
  const currentById = new Map(current.map((row) => [row.id || row.userId, row]));
  return {
    upsert: current.filter((row) => JSON.stringify(previousById.get(row.id || row.userId)) !== JSON.stringify(row)).map(toRow),
    deleted: [...previousById.keys()].filter((id) => !currentById.has(id))
  };
}

export function persistRemoteState(state) {
  const snapshot = structuredClone(state);
  const operation = saveQueue.then(async () => {
    if (!baseline) throw new Error('共有データを読み込んでから保存してください。');
    const records = changedRows(baseline.records, snapshot.records, recordToDatabase);
    const shifts = changedRows(baseline.activeShifts, snapshot.activeShifts, shiftToDatabase);
    const client = await getSupabaseClient();
    const { error } = await client.rpc('save_app_changes', {
      p_records_upsert: records.upsert,
      p_deleted_record_ids: records.deleted,
      p_shifts_upsert: shifts.upsert,
      p_deleted_shift_user_ids: shifts.deleted
    });
    if (error) throw error;
    return loadRemoteState();
  });
  saveQueue = operation.catch(() => {});
  return operation;
}
