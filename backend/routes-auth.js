import express from 'express'
import bcrypt from 'bcrypt'
import crypto from 'crypto'
import { q } from './db.js'
import { sendResetEmail } from './mailer.js'

export const auth = express.Router()

auth.post('/login', async (req,res)=>{
  const { email, password } = req.body || {}
  if(!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' })
  const user = await q.get(`SELECT * FROM users WHERE email=?`, [email])
  if(!user) return res.status(401).json({ error: 'Credenciales inválidas' })
  if(user.active===0) return res.status(403).json({ error: 'Cuenta desactivada' })
  const ok = await bcrypt.compare(password, user.password_hash)
  if(!ok) return res.status(401).json({ error: 'Credenciales inválidas' })
  req.session.user = { id: user.id, email: user.email, role: user.role, company_id: user.company_id }
  res.json({ user: req.session.user })
})

auth.post('/logout', (req,res)=>{
  req.session.destroy(()=> res.json({ ok:true }))
})

auth.get('/me', (req,res)=>{
  res.json({ user: req.session?.user || null })
})

auth.post('/forgot', async (req,res)=>{
  const { email } = req.body || {}
  if(!email) return res.status(400).json({ error: 'Email requerido' })
  const user = await q.get(`SELECT * FROM users WHERE email=?`, [email])
  if(!user) return res.status(404).json({ error: 'No existe usuario con ese email' })
  
  const token = crypto.randomBytes(24).toString('hex')
  const expires_at = new Date(Date.now()+1000*60*60).toISOString()
  await q.run(`INSERT INTO password_resets(user_id,token,expires_at) VALUES(?,?,?)`, [user.id, token, expires_at])
  
  // Construir el link de reset
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http'
  const host = process.env.APP_HOST || 'localhost:3000'
  const resetLink = `${protocol}://${host}/reset.html?token=${token}`
  
  try{
    const result = await sendResetEmail(email, token, resetLink)
    res.json({ ok:true, preview_url: result.preview_url || resetLink })
  }catch(err){
    console.error('Error sending email:', err)
    res.status(500).json({ error: 'No se pudo enviar el email' })
  }
})

auth.post('/reset', async (req,res)=>{
  const { token, password } = req.body || {}
  if(!token || !password) return res.status(400).json({ error: 'Datos requeridos' })
  const row = await q.get(`SELECT * FROM password_resets WHERE token=? AND used=0`, [token])
  if(!row) return res.status(400).json({ error: 'Token inválido' })
  if(new Date(row.expires_at).getTime() < Date.now()) return res.status(400).json({ error: 'Token caducado' })
  const hash = await bcrypt.hash(password, 10)
  await q.run(`UPDATE users SET password_hash=? WHERE id=?`, [hash, row.user_id])
  await q.run(`UPDATE password_resets SET used=1 WHERE id=?`, [row.id])
  res.json({ ok:true })
})

auth.post('/register_company', async (req,res)=>{
  const { name, fiscal_address, tax_id, phone, email, password } = req.body || {}
  if(!name || !email || !password) return res.status(400).json({ error:'Nombre, email y contraseña requeridos' })
  const comp = await q.run(`INSERT INTO companies(name,fiscal_address,tax_id,phone) VALUES(?,?,?,?)`, [name, fiscal_address || null, tax_id || null, phone || null])
  const hash = await bcrypt.hash(password, 10)
  try{
    await q.run(`INSERT INTO users(email,password_hash,role,company_id) VALUES(?,?,?,?)`, [email, hash, 'ADMIN', comp.lastID])
    res.json({ ok:true })
  }catch(e){
    res.status(400).json({ error:'No se pudo crear el admin (¿email duplicado?)' })
  }
})
