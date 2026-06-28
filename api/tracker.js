// api/tracker.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function getPrevDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

module.exports = async function handler(req, res) {
  // set CORS headers on every response
  Object.entries(HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;

  try {
    /* ── GET STATE ── */
    if (action === 'get-state') {
      const { device_id, date_key } = req.query;
      const { data, error } = await supabase
        .from('daily_state')
        .select('*')
        .eq('device_id', device_id)
        .eq('date_key', date_key);
      if (error) throw error;
      return res.status(200).json({ success: true, data });
    }

    /* ── COMPLETE TASK ── */
    if (action === 'complete-task') {
      const { device_id, date_key, task_id, task_name, note } = req.body;

      const { error: e1 } = await supabase
        .from('daily_state')
        .upsert(
          { device_id, date_key, task_id, completed: true, note,
            completed_at: new Date().toISOString() },
          { onConflict: 'device_id,date_key,task_id' }
        );
      if (e1) throw e1;

      const { error: e2 } = await supabase
        .from('learning_logs')
        .upsert(
          { device_id, date_key, task_id, task_name, note,
            logged_at: new Date().toISOString() },
          { onConflict: 'device_id,date_key,task_id' }
        );
      if (e2) throw e2;

      return res.status(200).json({ success: true });
    }

    /* ── RECORD DAY ── */
    if (action === 'record-day') {
      const { device_id, date_key, is_perfect, tasks_done } = req.body;

      const { error: e1 } = await supabase
        .from('day_history')
        .upsert(
          { device_id, date_key, is_perfect, tasks_done },
          { onConflict: 'device_id,date_key' }
        );
      if (e1) throw e1;

      // fetch current streak
      const { data: row } = await supabase
        .from('streaks')
        .select('*')
        .eq('device_id', device_id)
        .single();

      let current  = row?.current  || 0;
      let best     = row?.best     || 0;
      let lastDate = row?.last_date || null;

      if (is_perfect) {
        const prev = getPrevDay(date_key);
        if      (lastDate === prev)      current += 1;
        else if (lastDate === date_key)  { /* already counted */ }
        else                             current = 1;
        if (current > best) best = current;
        lastDate = date_key;
      } else {
        if (lastDate !== date_key) current = 0;
      }

      const { error: e2 } = await supabase
        .from('streaks')
        .upsert(
          { device_id, current, best, last_date: lastDate,
            updated_at: new Date().toISOString() },
          { onConflict: 'device_id' }
        );
      if (e2) throw e2;

      return res.status(200).json({ success: true, streak: { current, best } });
    }

    /* ── GET STREAK ── */
    if (action === 'get-streak') {
      const { device_id } = req.query;
      const { data, error } = await supabase
        .from('streaks')
        .select('*')
        .eq('device_id', device_id)
        .single();
      if (error && error.code !== 'PGRST116') throw error;
      return res.status(200).json({
        success: true,
        data: data || { current: 0, best: 0, last_date: null },
      });
    }

    /* ── GET HISTORY ── */
    if (action === 'get-history') {
      const { device_id } = req.query;
      const { data, error } = await supabase
        .from('day_history')
        .select('*')
        .eq('device_id', device_id)
        .order('date_key', { ascending: false });
      if (error) throw error;
      return res.status(200).json({ success: true, data });
    }

    /* ── GET LOGS ── */
    if (action === 'get-logs') {
      const { device_id } = req.query;
      const { data, error } = await supabase
        .from('learning_logs')
        .select('*')
        .eq('device_id', device_id)
        .order('logged_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json({ success: true, data });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: err.message });
  }
};