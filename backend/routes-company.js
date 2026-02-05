import express from 'express'
import { q } from './db.js'
import { requireAuth, requireRole } from './middleware.js'

export const company = express.Router()
company.get('/', requireAuth, async (req,res)=>{
  const c = await q.get(`SELECT * FROM companies LIMIT 1`)
  res.json({ company: c })
})
company.post('/location', requireAuth, requireRole('ADMIN'), async (req,res)=>{
  const { lat, lng } = req.body || {}
  const latN = Number(lat), lngN = Number(lng)
  if(!Number.isFinite(latN) || !Number.isFinite(lngN)) return res.status(400).json({ error: 'Lat/Lng inválidos' })
  await q.run(`UPDATE companies SET lat=?, lng=? WHERE id=(SELECT id FROM companies LIMIT 1)`, [latN, lngN])
  const c = await q.get(`SELECT * FROM companies LIMIT 1`)
  res.json({ company: c })
})

export const employees = express.Router()
employees.get('/', requireAuth, requireRole('ADMIN'), async (req,res)=>{
  const rows = await q.all(`SELECT e.id, u.id as user_id, u.active, u.email, e.overtime_rate, e.allow_diets, e.allow_transport, e.allow_lodging, e.salary, e.daily_hours, e.weekly_hours, e.vacation_days, e.vacation_days_used, e.vacation_year, e.dni, e.birthdate, e.phone, e.contact_email, e.position, e.contract_type, e.pay_installments FROM employees e JOIN users u ON u.id=e.user_id ORDER BY e.id DESC`)
  res.json({ employees: rows })
})
employees.get('/me', requireAuth, async (req,res)=>{
  const u = req.session.user
  const row = await q.get(`SELECT e.*, u.email as user_email FROM employees e JOIN users u ON u.id=e.user_id WHERE e.user_id=?`, [u.id])
  if(!row) return res.status(404).json({ error:'Empleado no encontrado' })
  res.json({ employee: row })
})
employees.post('/', requireAuth, requireRole('ADMIN'), async (req,res)=>{
  const { email, password, overtime_rate, allow_diets, allow_transport, allow_lodging, salary, daily_hours, weekly_hours, vacation_days, dni, birthdate, phone, contact_email, position, contract_type, pay_installments } = req.body || {}
  if(!email || !password) return res.status(400).json({ error:'Email y contraseña requeridos' })
  const or = Number(overtime_rate ?? 15)
  const sal = Number(salary ?? 0)
  const dh = Number(daily_hours ?? 8)
  const wh = Number(weekly_hours ?? 40)
  const vac = Number(vacation_days ?? 22)
  const pi = Number(pay_installments ?? 12)
  if(![or,sal,dh,wh,vac,pi].every(Number.isFinite)) return res.status(400).json({ error:'Datos numéricos inválidos' })
  const ad = !!allow_diets ? 1 : 0
  const at = !!allow_transport ? 1 : 0
  const al = !!allow_lodging ? 1 : 0
  const hash = await (await import('bcrypt')).default.hash(password, 10)
  try{
    const company_id = req.session.user.company_id
    const u = await q.run(`INSERT INTO users(email,password_hash,role,company_id) VALUES(?,?,?,?)`, [email, hash, 'WORKER', company_id])
    await q.run(`INSERT INTO employees(user_id,overtime_rate,allow_diets,allow_transport,allow_lodging,salary,daily_hours,weekly_hours,vacation_days,dni,birthdate,phone,contact_email,position,contract_type,pay_installments) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [u.lastID, or, ad, at, al, sal, dh, wh, vac, dni || null, birthdate || null, phone || null, contact_email || email, position || null, contract_type || null, pi])
    res.json({ ok:true })
  }catch(e){
    res.status(400).json({ error:'No se pudo crear el empleado (¿email duplicado?)' })
  }
})
employees.patch('/:id', requireAuth, requireRole('ADMIN'), async (req,res)=>{
  const id = Number(req.params.id)
  const { overtime_rate, allow_diets, allow_transport, allow_lodging, salary, daily_hours, weekly_hours, vacation_days } = req.body || {}
  if(!Number.isFinite(id)) return res.status(400).json({ error:'ID inválido' })
  await q.run(`UPDATE employees SET overtime_rate=?, allow_diets=?, allow_transport=?, allow_lodging=?, salary=?, daily_hours=?, weekly_hours=?, vacation_days=? WHERE id=?`,
    [Number(overtime_rate??15), !!allow_diets?1:0, !!allow_transport?1:0, !!allow_lodging?1:0, Number(salary??0), Number(daily_hours??8), Number(weekly_hours??40), Number(vacation_days??22), id])
  res.json({ ok:true })
})

employees.patch('/:id/deactivate', requireAuth, requireRole('ADMIN'), async (req,res)=>{
  const id = Number(req.params.id)
  if(!Number.isFinite(id)) return res.status(400).json({ error:'ID inválido' })
  const emp = await q.get(`SELECT user_id FROM employees WHERE id=?`, [id])
  if(!emp) return res.status(404).json({ error:'Empleado no encontrado' })
  await q.run(`UPDATE users SET active=0 WHERE id=?`, [emp.user_id])
  res.json({ ok:true })
})

employees.patch('/:id/activate', requireAuth, requireRole('ADMIN'), async (req,res)=>{
  const id = Number(req.params.id)
  if(!Number.isFinite(id)) return res.status(400).json({ error:'ID inválido' })
  const emp = await q.get(`SELECT user_id FROM employees WHERE id=?`, [id])
  if(!emp) return res.status(404).json({ error:'Empleado no encontrado' })
  await q.run(`UPDATE users SET active=1 WHERE id=?`, [emp.user_id])
  res.json({ ok:true })
})

// Employee statistics for export
employees.get('/:id/stats', requireAuth, requireRole('ADMIN'), async (req,res)=>{
  const id = Number(req.params.id)
  if(!Number.isFinite(id)) return res.status(400).json({ error:'ID inválido' })
  
  const emp = await q.get(`SELECT e.*, u.email FROM employees e JOIN users u ON u.id=e.user_id WHERE e.id=?`, [id])
  if(!emp) return res.status(404).json({ error:'Empleado no encontrado' })
  
  const userId = emp.user_id
  
  // Días trabajados (días únicos con timesheets)
  const daysWorked = await q.get(`SELECT COUNT(DISTINCT date) as count FROM timesheets WHERE user_id=?`, [userId])
  
  // Total gastos aceptados
  const totalExpenses = await q.get(`SELECT COALESCE(SUM(amount), 0) as total FROM tickets WHERE user_id=? AND status='APROBADO'`, [userId])
  
  // Días de vacaciones (vacaciones aceptadas) - calculamos desde start_date y end_date
  const vacations = await q.all(`SELECT start_date, end_date FROM vacation_requests WHERE user_id=? AND status='ACEPTADO'`, [userId])
  const vacationDays = vacations.reduce((total, vac) => {
    const start = new Date(vac.start_date)
    const end = new Date(vac.end_date)
    const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1
    return total + days
  }, 0)
  
  // Tickets aceptados y rechazados
  const ticketsApproved = await q.get(`SELECT COUNT(*) as count FROM tickets WHERE user_id=? AND status='APROBADO'`, [userId])
  const ticketsRejected = await q.get(`SELECT COUNT(*) as count FROM tickets WHERE user_id=? AND status='RECHAZADO'`, [userId])
  
  res.json({
    email: emp.email,
    days_worked: daysWorked.count || 0,
    total_expenses: totalExpenses.total || 0,
    vacation_days: vacationDays || 0,
    tickets_approved: ticketsApproved.count || 0,
    tickets_rejected: ticketsRejected.count || 0
  })
})
