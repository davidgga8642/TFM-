import express from 'express'
import session from 'express-session'
import SQLiteStoreFactory from 'connect-sqlite3'
import helmet from 'helmet'
import path from 'path'
import { fileURLToPath } from 'url'
import { init } from './db.js'
import { initMailer } from './mailer.js'
import { auth } from './routes-auth.js'
import { company, employees } from './routes-company.js'
import { timesheets } from './routes-timesheets.js'
import { tickets } from './routes-tickets.js'
import { finance } from './routes-finance.js'
import { vacations } from './routes-vacations.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const SQLiteStore = SQLiteStoreFactory(session)

app.use(helmet({ contentSecurityPolicy:false }))
app.use(express.json({ limit:'2mb' }))
app.use(express.urlencoded({ extended:true }))

app.use(session({
  store: new SQLiteStore({ db:'sessions.sqlite', dir: __dirname }),
  secret: 'tfm-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly:true, sameSite:'lax', maxAge: 1000*60*60*8 }
}))

app.use('/uploads', express.static(path.join(__dirname, 'uploads')))
app.use('/', express.static(path.join(__dirname, '..', 'frontend')))

app.use('/api/auth', auth)
app.use('/api/company', company)
app.use('/api/employees', employees)
app.use('/api/timesheets', timesheets)
app.use('/api/tickets', tickets)
app.use('/api/finance', finance)
app.use('/api/vacations', vacations)

const PORT = process.env.PORT || 3000
init().then(async ()=>{
  await initMailer()
  app.listen(PORT, ()=> console.log('✅ API/WEB en http://localhost:'+PORT))
}).catch(err=>{
  console.error('Error init DB', err); process.exit(1)
})

