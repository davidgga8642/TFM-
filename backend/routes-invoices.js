import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { q } from './db.js'
import { requireAuth, requireRole } from './middleware.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const uploadDir = path.join(__dirname, 'uploads')
fs.mkdirSync(uploadDir, { recursive: true })

const storage = multer.diskStorage({
  destination: (req, file, cb)=> cb(null, uploadDir),
  filename: (req, file, cb)=>{
    const safeName = Date.now() + '_' + file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_')
    cb(null, safeName)
  }
})
function fileFilter(req, file, cb){
  if(file.mimetype === 'application/pdf') cb(null, true); else cb(new Error('Solo se permiten PDF'))
}
const upload = multer({ storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } })

export const invoices = express.Router()

invoices.post('/', requireAuth, requireRole('ADMIN'), upload.single('file'), async (req,res)=>{
  const { client_name, amount, month } = req.body || {}
  if(!client_name || !month) return res.status(400).json({ error:'Cliente y mes requeridos' })
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error:'Mes inválido (YYYY-MM)' })
  const amountN = Number(amount)
  if(!Number.isFinite(amountN)) return res.status(400).json({ error:'Importe inválido' })
  if(!req.file) return res.status(400).json({ error:'Archivo PDF requerido' })
  const created_at = new Date().toISOString()
  await q.run(`INSERT INTO invoices(client_name, amount, month, file_path, file_mime, created_at) VALUES(?,?,?,?,?,?)`,
    [client_name.trim(), amountN, month, req.file.path, req.file.mimetype, created_at])
  res.json({ ok:true })
})

invoices.get('/', requireAuth, requireRole('ADMIN'), async (req,res)=>{
  const rows = await q.all(`SELECT id, client_name, amount, month, created_at FROM invoices ORDER BY id DESC`)
  res.json({ invoices: rows })
})

invoices.get('/:id/file', requireAuth, requireRole('ADMIN'), async (req,res)=>{
  const id = Number(req.params.id)
  if(!Number.isFinite(id)) return res.status(400).json({ error:'ID inválido' })
  const inv = await q.get(`SELECT file_path, file_mime FROM invoices WHERE id=?`, [id])
  if(!inv) return res.status(404).json({ error:'Factura no encontrada' })
  if(!fs.existsSync(inv.file_path)) return res.status(404).json({ error:'Archivo no encontrado' })
  res.setHeader('Content-Type', inv.file_mime)
  res.sendFile(path.resolve(inv.file_path))
})
