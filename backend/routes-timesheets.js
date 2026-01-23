import express from 'express'
import { q } from './db.js'
import { requireAuth, requireRole } from './middleware.js'
import { toIsoDate, toIsoTime, haversineMeters, hoursBetween } from './util.js'

export const timesheets = express.Router()
const RADIUS = 200

timesheets.post('/start', requireAuth, requireRole('WORKER'), async (req,res)=>{
  const { lat, lng } = req.body || {}
  const latN = Number(lat), lngN = Number(lng)
  if(!Number.isFinite(latN) || !Number.isFinite(lngN)) return res.status(400).json({ error:'Ubicación inválida' })
  const c = await q.get(`SELECT lat,lng FROM companies LIMIT 1`)
  const dist = Math.round(haversineMeters(latN, lngN, c.lat, c.lng))
  const within = dist <= RADIUS ? 1 : 0
  const date = toIsoDate(new Date()), iso = toIsoTime(new Date())
  await q.run(`INSERT INTO timesheets(user_id,date,start_time,start_lat,start_lng,start_within) VALUES(?,?,?,?,?,?)`, [req.session.user.id, date, iso, latN, lngN, within])
  res.json({ ok:true, distance_m: dist, within_radius: !!within, radius_m: RADIUS })
})

timesheets.post('/end', requireAuth, requireRole('WORKER'), async (req,res)=>{
  const { lat, lng } = req.body || {}
  const latN = Number(lat), lngN = Number(lng)
  if(!Number.isFinite(latN) || !Number.isFinite(lngN)) return res.status(400).json({ error:'Ubicación inválida' })
  const open = await q.get(`SELECT * FROM timesheets WHERE user_id=? AND end_time IS NULL ORDER BY id DESC LIMIT 1`, [req.session.user.id])
  if(!open) return res.status(400).json({ error:'No hay jornada abierta' })
  const c = await q.get(`SELECT lat,lng FROM companies LIMIT 1`)
  const dist = Math.round(haversineMeters(latN, lngN, c.lat, c.lng))
  const within = dist <= RADIUS ? 1 : 0
  const iso = toIsoTime(new Date())
  await q.run(`UPDATE timesheets SET end_time=?, end_lat=?, end_lng=?, end_within=? WHERE id=?`, [iso, latN, lngN, within, open.id])
  const updated = await q.get(`SELECT * FROM timesheets WHERE id=?`, [open.id])
  const emp = await q.get(`SELECT daily_hours FROM employees WHERE user_id=?`, [req.session.user.id])
  const base = emp?.daily_hours ?? 8
  let hours = hoursBetween(updated.start_time, updated.end_time)
  // Restar tiempo de descanso si existe
  if(updated.break_start && updated.break_end){
    const breakHours = hoursBetween(updated.break_start, updated.break_end)
    hours = Math.max(0, hours - breakHours)
  }
  const overtime = Math.max(0, hours - base)
  res.json({ ok:true, distance_m: dist, within_radius: !!within, radius_m: RADIUS, hours: Number(hours.toFixed(2)), overtime: Number(overtime.toFixed(2)) })
})

timesheets.post('/break/start', requireAuth, requireRole('WORKER'), async (req,res)=>{
  const open = await q.get(`SELECT * FROM timesheets WHERE user_id=? AND end_time IS NULL ORDER BY id DESC LIMIT 1`, [req.session.user.id])
  if(!open) return res.status(400).json({ error:'No hay jornada abierta' })
  const iso = toIsoTime(new Date())
  await q.run(`UPDATE timesheets SET break_start=? WHERE id=?`, [iso, open.id])
  res.json({ ok:true, message:'Inicio de descanso registrado' })
})

timesheets.post('/break/end', requireAuth, requireRole('WORKER'), async (req,res)=>{
  const open = await q.get(`SELECT * FROM timesheets WHERE user_id=? AND end_time IS NULL ORDER BY id DESC LIMIT 1`, [req.session.user.id])
  if(!open) return res.status(400).json({ error:'No hay jornada abierta' })
  if(!open.break_start) return res.status(400).json({ error:'No hay descanso iniciado' })
  const iso = toIsoTime(new Date())
  await q.run(`UPDATE timesheets SET break_end=? WHERE id=?`, [iso, open.id])
  res.json({ ok:true, message:'Fin de descanso registrado' })
})

timesheets.get('/my', requireAuth, requireRole('WORKER'), async (req,res)=>{
  const rows = await q.all(`SELECT * FROM timesheets WHERE user_id=? ORDER BY date DESC, id DESC`, [req.session.user.id])
  const emp = await q.get(`SELECT daily_hours FROM employees WHERE user_id=?`, [req.session.user.id])
  const base = emp?.daily_hours ?? 8
  const mapped = rows.map(r=>{
    let hours = r.end_time ? (new Date(r.end_time)-new Date(r.start_time))/36e5 : 0
    // Restar tiempo de descanso si existe
    if(r.break_start && r.break_end){
      const breakHours = (new Date(r.break_end)-new Date(r.break_start))/36e5
      hours = Math.max(0, hours - breakHours)
    }
    const overtime = Math.max(0, hours - base)
    return {
      id: r.id,
      date: r.date,
      start_time: r.start_time,
      break_start: r.break_start,
      break_end: r.break_end,
      end_time: r.end_time,
      hours: Number(hours.toFixed(2)),
      overtime: Number(overtime.toFixed(2))
    }
  })
  res.json({ timesheets: mapped })
})

timesheets.get('/overtime/summary', requireAuth, async (req,res)=>{
  let sql = `SELECT substr(date,1,7) as month, SUM(CASE WHEN end_time IS NOT NULL THEN (julianday(end_time)-julianday(start_time))*24 ELSE 0 END) as hours
             FROM timesheets WHERE 1=1`
  const params = []
  if(req.session.user.role === 'WORKER'){
    sql += ` AND user_id=?`; params.push(req.session.user.id)
  }
  sql += ` GROUP BY month ORDER BY month`
  const rows = await q.all(sql, params)
  const mapped = rows.map(r=>{
    const days = r.hours>0? Math.ceil(r.hours/8):0
    const extra = Math.max(0, r.hours - (days*8))
    return { month: r.month, hours: Number(r.hours.toFixed(2)), overtime: Number(extra.toFixed(2)) }
  })
  res.json({ series: mapped })
})

// Timesheet Requests (Solicitudes de jornada)
timesheets.post('/requests', requireAuth, requireRole('WORKER'), async (req,res)=>{
  const { date, start_time, end_time, break_start, break_end } = req.body || {}
  if(!date || !start_time || !end_time) return res.status(400).json({ error:'Faltan campos' })
  const created_at = new Date().toISOString()
  await q.run(`INSERT INTO timesheet_requests(user_id,date,start_time,end_time,break_start,break_end,created_at) VALUES(?,?,?,?,?,?,?)`,
    [req.session.user.id, date, start_time, end_time, break_start || null, break_end || null, created_at])
  res.json({ ok:true, message:'Solicitud de jornada creada' })
})

timesheets.get('/requests/my', requireAuth, requireRole('WORKER'), async (req,res)=>{
  const rows = await q.all(`SELECT * FROM timesheet_requests WHERE user_id=? ORDER BY date DESC`, [req.session.user.id])
  const mapped = rows.map(r=>({
    id: r.id,
    date: r.date,
    start_time: r.start_time,
    end_time: r.end_time,
    break_start: r.break_start,
    break_end: r.break_end,
    status: r.status,
    reason: r.reason,
    created_at: r.created_at
  }))
  res.json({ requests: mapped })
})

timesheets.get('/requests/pending', requireAuth, requireRole('ADMIN'), async (req,res)=>{
  const rows = await q.all(`SELECT tr.*, u.email FROM timesheet_requests tr JOIN users u ON tr.user_id=u.id WHERE tr.status='PENDIENTE' ORDER BY tr.created_at DESC`)
  const mapped = rows.map(r=>({
    id: r.id,
    user_id: r.user_id,
    email: r.email,
    date: r.date,
    start_time: r.start_time,
    end_time: r.end_time,
    break_start: r.break_start,
    break_end: r.break_end,
    created_at: r.created_at
  }))
  res.json({ requests: mapped })
})

timesheets.post('/requests/:id/approve', requireAuth, requireRole('ADMIN'), async (req,res)=>{
  const { id } = req.params
  const request = await q.get(`SELECT * FROM timesheet_requests WHERE id=?`, [id])
  if(!request) return res.status(400).json({ error:'Solicitud no encontrada' })
  
  // Convertir start_time y end_time a formato ISO completo
  const startISO = `${request.date}T${request.start_time}:00`
  const endISO = `${request.date}T${request.end_time}:00`
  const breakStartISO = request.break_start ? `${request.date}T${request.break_start}:00` : null
  const breakEndISO = request.break_end ? `${request.date}T${request.break_end}:00` : null
  
  // Crear la jornada en timesheets
  await q.run(`INSERT INTO timesheets(user_id,date,start_time,end_time,break_start,break_end) VALUES(?,?,?,?,?,?)`,
    [request.user_id, request.date, startISO, endISO, breakStartISO, breakEndISO])
  
  // Actualizar estado de la solicitud
  await q.run(`UPDATE timesheet_requests SET status='ACEPTADO', approved_by=? WHERE id=?`, [req.session.user.id, id])
  res.json({ ok:true, message:'Solicitud aceptada' })
})

timesheets.post('/requests/:id/reject', requireAuth, requireRole('ADMIN'), async (req,res)=>{
  const { id } = req.params
  const { reason } = req.body || {}
  const request = await q.get(`SELECT * FROM timesheet_requests WHERE id=?`, [id])
  if(!request) return res.status(400).json({ error:'Solicitud no encontrada' })
  
  await q.run(`UPDATE timesheet_requests SET status='RECHAZADO', reason=?, approved_by=? WHERE id=?`, [reason || '', req.session.user.id, id])
  res.json({ ok:true, message:'Solicitud rechazada' })
})
