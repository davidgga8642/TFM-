import express from 'express'
import { q } from './db.js'
import { requireAuth, requireRole } from './middleware.js'

export const finance = express.Router()
finance.get('/countries', requireAuth, async (req,res)=>{
  const rows = await q.all(`SELECT * FROM countries ORDER BY name`)
  res.json({ countries: rows })
})
finance.post('/countries', requireAuth, requireRole('ADMIN'), async (req,res)=>{
  const { code, name, corporate_tax, social_rate } = req.body || {}
  if(!code || !name) return res.status(400).json({ error:'Código y nombre requeridos' })
  const ct = Number(corporate_tax), sr = Number(social_rate)
  if(!Number.isFinite(ct) || !Number.isFinite(sr)) return res.status(400).json({ error:'Tipos inválidos' })
  try{
    await q.run(`INSERT INTO countries(code,name,corporate_tax,social_rate) VALUES(?,?,?,?)`, [code, name, ct, sr])
    res.json({ ok:true })
  }catch(e){ res.status(400).json({ error:'No se pudo insertar (¿código duplicado?)' }) }
})
finance.post('/entry', requireAuth, requireRole('ADMIN'), async (req,res)=>{
  const { month, country_code, incomes, expenses, salaries } = req.body || {}
  if(!month || !country_code) return res.status(400).json({ error:'Mes y país requeridos' })
  const inc = Number(incomes), exp = Number(expenses), sal = Number(salaries)
  if(![inc,exp,sal].every(Number.isFinite)) return res.status(400).json({ error:'Valores numéricos inválidos' })
  const c = await q.get(`SELECT * FROM countries WHERE code=?`, [country_code])
  if(!c) return res.status(400).json({ error:'País no soportado' })
  const gross = inc - exp - sal
  const corporate_tax = gross>0 ? gross*c.corporate_tax : 0
  const social_costs = sal * c.social_rate
  const net = gross - corporate_tax - social_costs
  await q.run(`INSERT INTO finance_entries(month,country_code,incomes,expenses,salaries) VALUES(?,?,?,?,?)`, [month, country_code, inc, exp, sal])
  res.json({
    month, country_code,
    inputs:{ incomes:inc, expenses:exp, salaries:sal },
    computed:{ gross_profit: round2(gross), corporate_tax:round2(corporate_tax), social_costs:round2(social_costs), net_result:round2(net) },
    legal_notice:"Los cálculos mostrados son orientativos y no sustituyen el asesoramiento fiscal profesional."
  })
})
finance.get('/entries', requireAuth, requireRole('ADMIN'), async (req,res)=>{
  const rows = await q.all(`SELECT * FROM finance_entries ORDER BY month`)
  res.json({ entries: rows })
})
finance.get('/summary', requireAuth, requireRole('ADMIN'), async (req,res)=>{
  const rows = await q.all(`SELECT month, SUM(incomes) as incomes, SUM(expenses) as expenses, SUM(salaries) as salaries FROM finance_entries GROUP BY month ORDER BY month`)
  const ticketRows = await q.all(`SELECT substr(created_at,1,7) as month, SUM(amount) as amount FROM tickets WHERE status='APROBADO' GROUP BY substr(created_at,1,7) ORDER BY month`)
  const invRows = await q.all(`SELECT month, SUM(amount) as amount FROM invoices GROUP BY month ORDER BY month`)
  const otUserRows = await q.all(`
    SELECT 
      u.email AS email,
      substr(t.date,1,7) AS month,
      SUM(
        CASE 
          WHEN t.start_time IS NOT NULL AND t.end_time IS NOT NULL THEN 
            (
              CASE 
                WHEN (
                  (
                    (
                      (strftime('%s', t.end_time) - strftime('%s', t.start_time))
                      - CASE WHEN t.break_start IS NOT NULL AND t.break_end IS NOT NULL THEN (strftime('%s', t.break_end) - strftime('%s', t.break_start)) ELSE 0 END
                    ) / 3600.0
                  )
                ) > COALESCE(e.daily_hours, 8)
                THEN (
                  (
                    (strftime('%s', t.end_time) - strftime('%s', t.start_time))
                    - CASE WHEN t.break_start IS NOT NULL AND t.break_end IS NOT NULL THEN (strftime('%s', t.break_end) - strftime('%s', t.break_start)) ELSE 0 END
                  ) / 3600.0
                ) - COALESCE(e.daily_hours, 8)
                ELSE 0
              END
            )
          ELSE 0 
        END
      ) AS hours
    FROM timesheets t 
    JOIN users u ON u.id = t.user_id 
    LEFT JOIN employees e ON e.user_id = u.id
    GROUP BY u.email, substr(t.date,1,7) 
    ORDER BY month
  `)
  const months = Array.from(new Set([...(rows.map(r=>r.month)), ...(invRows.map(r=>r.month)), ...(ticketRows.map(r=>r.month)), ...(otUserRows.map(r=>r.month))])).sort()
  const finMap = new Map(rows.map(r=>[r.month, r]))
  const invMap = new Map(invRows.map(r=>[r.month, round2(r.amount)]))
  const tickMap = new Map(ticketRows.map(r=>[r.month, round2(r.amount)]))
  const finance_incomes = months.map(m=> round2(finMap.get(m)?.incomes || 0))
  const incomes = months.map(m=> round2((finMap.get(m)?.incomes || 0) + (invMap.get(m) || 0)))
  const ticket_expenses = months.map(m=> round2(tickMap.get(m) || 0))
  const expenses = months.map(m=> round2((finMap.get(m)?.expenses || 0) + (tickMap.get(m) || 0)))
  // Active employees salaries (current active users)
  const activeSalaryRows = await q.all(`SELECT salary FROM employees e JOIN users u ON u.id=e.user_id WHERE u.active=1`)
  const activeSalarySum = activeSalaryRows.reduce((a,r)=> a + (r.salary||0), 0)
  const salaries = months.map(m=> round2(finMap.get(m)?.salaries || 0))
  const active_salaries = months.map(()=> round2(activeSalarySum))
  const gross = months.map((_,i)=> round2(incomes[i]-expenses[i]-salaries[i]))
  let taxRate = 0.25
  const latest = await q.get(`SELECT country_code FROM finance_entries ORDER BY id DESC LIMIT 1`)
  if(latest){ const c = await q.get(`SELECT corporate_tax FROM countries WHERE code=?`, [latest.country_code]); if(c) taxRate = c.corporate_tax }
  const taxes = gross.map(v=> v>0? round2(v*taxRate):0)
  const net = gross.map((v,i)=> round2(v - taxes[i]))
  const empRows = await q.all(`SELECT salary FROM employees`)
  const empSalariesTotal = empRows.reduce((a,r)=> a + (r.salary||0), 0)
  const emp_salaries = months.map(()=> round2(empSalariesTotal))
  const overtime_by_employee = otUserRows.map(r=>({ email: r.email, month: r.month, hours: round2(r.hours || 0) }))
  // Total overtime per month (summing employees)
  const overtime = months.map(m=>{
    const sum = overtime_by_employee.filter(o=>o.month===m).reduce((a,b)=> a + b.hours, 0)
    return round2(sum)
  })
  const invoice_incomes = months.map(m=> invMap.get(m) || 0)
  res.json({ months, series:{ incomes, finance_incomes, expenses, ticket_expenses, salaries, active_salaries, emp_salaries, gross, taxes, net, overtime, overtime_by_employee, invoice_incomes } })
})

finance.post('/reset', requireAuth, requireRole('ADMIN'), async (req,res)=>{
  await q.run(`DELETE FROM finance_entries`)
  await q.run(`DELETE FROM invoices`)
  await q.run(`UPDATE tickets SET status='PENDIENTE', reason=NULL WHERE status IN ('APROBADO','RECHAZADO')`)
  res.json({ ok:true })
})
function round2(n){ return Math.round(n*100)/100 }
