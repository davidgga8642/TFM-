import sqlite3 from 'sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import bcrypt from 'bcrypt'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dbPath = path.join(__dirname, 'database.sqlite')

sqlite3.verbose()
export const db = new sqlite3.Database(dbPath)

function run(sql, params = []){
  return new Promise((resolve, reject)=>{
    db.run(sql, params, function(err){
      if(err) reject(err)
      else resolve(this)
    })
  })
}
function get(sql, params = []){
  return new Promise((resolve, reject)=>{
    db.get(sql, params, function(err, row){
      if(err) reject(err)
      else resolve(row)
    })
  })
}
function all(sql, params = []){
  return new Promise((resolve, reject)=>{
    db.all(sql, params, function(err, rows){
      if(err) reject(err)
      else resolve(rows)
    })
  })
}

export const q = { run, get, all }

async function ensureColumn(table, name, defSql){
  const cols = await all(`PRAGMA table_info(${table})`)
  if(!cols.find(c=> c.name===name)){
    await run(`ALTER TABLE ${table} ADD COLUMN ${defSql}`)
  }
}

export async function init(){
  await run(`PRAGMA foreign_keys = ON`)

  await run(`CREATE TABLE IF NOT EXISTS companies(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    fiscal_address TEXT,
    tax_id TEXT,
    phone TEXT,
    lat REAL DEFAULT 40.4168,
    lng REAL DEFAULT -3.7038
  )`)

  await run(`CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('ADMIN','WORKER')),
    company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    active INTEGER DEFAULT 1
  )`)

  await run(`CREATE TABLE IF NOT EXISTS employees(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    overtime_rate REAL DEFAULT 15,
    allow_diets INTEGER DEFAULT 1,
    allow_transport INTEGER DEFAULT 1,
    allow_lodging INTEGER DEFAULT 1,
    salary REAL DEFAULT 0,
    daily_hours REAL DEFAULT 8,
    weekly_hours REAL DEFAULT 40,
    vacation_days INTEGER DEFAULT 22,
    dni TEXT,
    birthdate TEXT,
    phone TEXT,
    contact_email TEXT,
    position TEXT,
    contract_type TEXT,
    pay_installments INTEGER DEFAULT 12
  )`)

  await run(`CREATE TABLE IF NOT EXISTS timesheets(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    start_time TEXT,
    start_lat REAL,
    start_lng REAL,
    start_within INTEGER DEFAULT 0,
    break_start TEXT,
    break_end TEXT,
    end_time TEXT,
    end_lat REAL,
    end_lng REAL,
    end_within INTEGER DEFAULT 0
  )`)

  await run(`CREATE TABLE IF NOT EXISTS tickets(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    category TEXT,
    amount REAL,
    status TEXT DEFAULT 'PENDIENTE',
    reason TEXT,
    file_path TEXT NOT NULL,
    file_mime TEXT NOT NULL
  )`)

  await run(`CREATE TABLE IF NOT EXISTS finance_entries(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month TEXT NOT NULL,
    country_code TEXT NOT NULL,
    incomes REAL NOT NULL,
    expenses REAL NOT NULL,
    salaries REAL NOT NULL
  )`)

  await run(`CREATE TABLE IF NOT EXISTS invoices(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_name TEXT NOT NULL,
    amount REAL NOT NULL,
    month TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_mime TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`)

  await run(`CREATE TABLE IF NOT EXISTS countries(
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    corporate_tax REAL NOT NULL,
    social_rate REAL NOT NULL
  )`)

  await run(`CREATE TABLE IF NOT EXISTS password_resets(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0
  )`)

  await run(`CREATE TABLE IF NOT EXISTS timesheet_requests(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    break_start TEXT,
    break_end TEXT,
    status TEXT DEFAULT 'PENDIENTE',
    reason TEXT,
    created_at TEXT NOT NULL,
    approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  )`)

  await ensureColumn('timesheet_requests', 'break_start', 'break_start TEXT')
  await ensureColumn('timesheet_requests', 'break_end', 'break_end TEXT')

  await run(`CREATE TABLE IF NOT EXISTS vacation_requests(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    status TEXT DEFAULT 'PENDIENTE',
    reason TEXT,
    created_at TEXT NOT NULL,
    approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  )`)

  await ensureColumn('companies','fiscal_address','fiscal_address TEXT')
  await ensureColumn('companies','tax_id','tax_id TEXT')
  await ensureColumn('companies','phone','phone TEXT')
  await ensureColumn('tickets','status',"status TEXT DEFAULT 'PENDIENTE'")
  await ensureColumn('tickets','reason','reason TEXT')
  await ensureColumn('employees','allow_lodging','allow_lodging INTEGER DEFAULT 1')
  await ensureColumn('employees','vacation_days_used','vacation_days_used INTEGER DEFAULT 0')
  await ensureColumn('employees','vacation_year','vacation_year INTEGER DEFAULT 2026')
  await ensureColumn('users','active','active INTEGER DEFAULT 1')
  await ensureColumn('employees','hire_date','hire_date TEXT')
  await ensureColumn('employees','termination_date','termination_date TEXT')

  // Seed
  const anyCompany = await get(`SELECT * FROM companies LIMIT 1`)
  if(!anyCompany){
    await run(`INSERT INTO companies(name, fiscal_address, tax_id, phone, lat, lng) VALUES(?,?,?,?,?,?)`,
      ['Empresa Demo', 'Madrid, España', 'B00000000', '+34 600 000 000', 40.4168, -3.7038])
  }
  const anyCountry = await get(`SELECT * FROM countries LIMIT 1`)
  if(!anyCountry){
    const seed = [
      ['ES','España', 0.25, 0.30],
      ['US','Estados Unidos', 0.21, 0.0765],
      ['DE','Alemania', 0.15, 0.20],
      ['FR','Francia', 0.25, 0.45]
    ]
    for(const c of seed) await run(`INSERT INTO countries(code,name,corporate_tax,social_rate) VALUES(?,?,?,?)`, c)
  }
  const admin = await get(`SELECT * FROM users WHERE email=?`, ['ceo@demo.com'])
  if(!admin){
    const hash = await bcrypt.hash('demo123', 10)
    const comp = await get(`SELECT id FROM companies LIMIT 1`)
    await run(`INSERT INTO users(email,password_hash,role,company_id) VALUES(?,?,?,?)`,
      ['ceo@demo.com', hash, 'ADMIN', comp.id])
  }
  const worker = await get(`SELECT * FROM users WHERE email=?`, ['worker@demo.com'])
  if(!worker){
    const hash = await bcrypt.hash('demo123', 10)
    const comp = await get(`SELECT id FROM companies LIMIT 1`)
    const res = await run(`INSERT INTO users(email,password_hash,role,company_id) VALUES(?,?,?,?)`,
      ['worker@demo.com', hash, 'WORKER', comp.id])
    await run(`INSERT INTO employees(user_id,overtime_rate,allow_diets,allow_transport,allow_lodging,salary,daily_hours,weekly_hours,vacation_days,contact_email) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [res.lastID, 15, 1, 1, 1, 1200, 8, 40, 22, 'worker@demo.com'])
  }
}
