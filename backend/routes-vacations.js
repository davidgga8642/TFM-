import express from 'express'
import { q } from './db.js'
import { requireAuth, requireRole } from './middleware.js'

export const vacations = express.Router()

// Worker: create vacation request
vacations.post('/', requireAuth, requireRole('WORKER'), async (req,res)=>{
  const { start_date, end_date } = req.body || {}
  if(!start_date || !end_date) return res.status(400).json({ error:'Fechas requeridas' })
  
  const start = new Date(start_date)
  const end = new Date(end_date)
  if(isNaN(start) || isNaN(end)) return res.status(400).json({ error:'Fechas inválidas' })
  if(start > end) return res.status(400).json({ error:'La fecha de inicio debe ser anterior a la de fin' })
  
  // Calcular días solicitados
  const requestedDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1
  
  // Verificar días disponibles del empleado
  const emp = await q.get(`SELECT vacation_days, vacation_days_used, vacation_year FROM employees WHERE user_id=?`, [req.session.user.id])
  if(!emp) return res.status(400).json({ error:'Empleado no encontrado' })
  
  // Verificar y resetear si es año nuevo
  const currentYear = new Date().getFullYear()
  let totalDays = emp.vacation_days ?? 22
  let usedDays = emp.vacation_days_used ?? 0
  
  if(emp.vacation_year !== currentYear){
    // Resetear días usados si es año nuevo
    await q.run(`UPDATE employees SET vacation_days_used=0, vacation_year=? WHERE user_id=?`, [currentYear, req.session.user.id])
    usedDays = 0
  }
  
  const availableDays = totalDays - usedDays
  if(requestedDays > availableDays){
    return res.status(400).json({ error:`Solo tienes ${availableDays} días disponibles. Solicitaste ${requestedDays} días.` })
  }
  
  const created_at = new Date().toISOString()
  await q.run(`INSERT INTO vacation_requests(user_id,start_date,end_date,created_at) VALUES(?,?,?,?)`,
    [req.session.user.id, start_date, end_date, created_at])
  res.json({ ok:true, message:'Solicitud de vacaciones creada' })
})

// Worker: list own requests
vacations.get('/my', requireAuth, requireRole('WORKER'), async (req,res)=>{
  const rows = await q.all(`SELECT * FROM vacation_requests WHERE user_id=? ORDER BY created_at DESC`, [req.session.user.id])
  const mapped = rows.map(r=>({
    id: r.id,
    start_date: r.start_date,
    end_date: r.end_date,
    status: r.status,
    reason: r.reason,
    created_at: r.created_at
  }))
  res.json({ requests: mapped })
})

// Admin: list pending requests
vacations.get('/pending', requireAuth, requireRole('ADMIN'), async (req,res)=>{
  const rows = await q.all(`SELECT vr.*, u.email FROM vacation_requests vr JOIN users u ON vr.user_id=u.id WHERE vr.status='PENDIENTE' ORDER BY vr.created_at DESC`)
  const mapped = rows.map(r=>({
    id: r.id,
    user_id: r.user_id,
    email: r.email,
    start_date: r.start_date,
    end_date: r.end_date,
    created_at: r.created_at
  }))
  res.json({ requests: mapped })
})

// Admin: approve request
vacations.post('/:id/approve', requireAuth, requireRole('ADMIN'), async (req,res)=>{
  const { id } = req.params
  const request = await q.get(`SELECT * FROM vacation_requests WHERE id=?`, [id])
  if(!request) return res.status(400).json({ error:'Solicitud no encontrada' })
  
  // Calcular días de la solicitud
  const start = new Date(request.start_date)
  const end = new Date(request.end_date)
  const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1
  
  // Actualizar días usados del empleado
  await q.run(`UPDATE employees SET vacation_days_used = vacation_days_used + ? WHERE user_id=?`, [days, request.user_id])
  
  // Actualizar estado de la solicitud
  await q.run(`UPDATE vacation_requests SET status='ACEPTADO', approved_by=? WHERE id=?`, [req.session.user.id, id])
  res.json({ ok:true, message:'Vacaciones aprobadas' })
})

// Admin: reject request
vacations.post('/:id/reject', requireAuth, requireRole('ADMIN'), async (req,res)=>{
  const { id } = req.params
  const { reason } = req.body || {}
  const request = await q.get(`SELECT * FROM vacation_requests WHERE id=?`, [id])
  if(!request) return res.status(400).json({ error:'Solicitud no encontrada' })
  
  await q.run(`UPDATE vacation_requests SET status='RECHAZADO', reason=?, approved_by=? WHERE id=?`, [reason || '', req.session.user.id, id])
  res.json({ ok:true, message:'Vacaciones rechazadas' })
})

// Admin: list accepted vacations
vacations.get('/accepted', requireAuth, requireRole('ADMIN'), async (req,res)=>{
  const rows = await q.all(`SELECT vr.*, u.email FROM vacation_requests vr JOIN users u ON vr.user_id=u.id WHERE vr.status='ACEPTADO' ORDER BY vr.start_date DESC`)
  const mapped = rows.map(r=>({
    id: r.id,
    user_id: r.user_id,
    email: r.email,
    start_date: r.start_date,
    end_date: r.end_date,
    created_at: r.created_at
  }))
  res.json({ requests: mapped })
})
