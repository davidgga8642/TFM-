import { api, me, el, isoToHm, ymdToDmy, fmtMoney } from './common.js'

const who = el('#who')
const tabs = document.querySelectorAll('.tab')
const sections = { dashboard: document.querySelector('#tab-dashboard'), time: document.querySelector('#tab-time'), tickets: document.querySelector('#tab-tickets'), vacations: document.querySelector('#tab-vacations') }
tabs.forEach(t=> t.addEventListener('click', ()=> activateTab(t.dataset.tab)))
function activateTab(id){ tabs.forEach(t=> t.classList.toggle('active', t.dataset.tab===id)); const sectionId = (id==='timesheets')? 'time' : id; for(const k in sections){ sections[k].style.display = (k===sectionId)? 'block':'none' } if(sectionId==='dashboard') loadDashboard(); if(id==='time' || id==='timesheets') loadTimesheets(); if(sectionId==='tickets') listTickets(); if(sectionId==='vacations') loadVacations(); }

async function init(){ const user=await me(); if(!user || user.role!=='WORKER'){ location.href='index.html'; return } who.textContent = `${user.email} • WORKER`; document.getElementById('startBtn').addEventListener('click', startDay); document.getElementById('breakStartBtn').addEventListener('click', breakStart); document.getElementById('breakEndBtn').addEventListener('click', breakEnd); document.getElementById('endBtn').addEventListener('click', endDay); document.getElementById('tSave').addEventListener('click', saveTicket); document.getElementById('reqSave').addEventListener('click', saveRequest); document.getElementById('vacSave').addEventListener('click', saveVacation); document.getElementById('reqHasBreak').addEventListener('change', toggleBreakFields); loadTimesheets(); loadDashboard(); loadRequests(); updateButtonStates();
  try{ const meEmp = await api('api/employees/me'); const s = document.getElementById('tCat'); s.innerHTML=''; if(meEmp.employee.allow_transport) s.innerHTML += '<option value="TRANSPORTE">Transporte</option>'; if(meEmp.employee.allow_diets) s.innerHTML += '<option value="DIETAS">Dietas</option>'; if(meEmp.employee.allow_lodging) s.innerHTML += '<option value="ALOJAMIENTO">Alojamiento</option>'; s.innerHTML += '<option value="OTROS">Otros</option>'; }catch(e){} }
init().catch(e=> alert(e.message))

function getLocationOnce(){ return new Promise((resolve,reject)=>{ if(!navigator.geolocation) return reject(new Error('Geolocalización no disponible')); navigator.geolocation.getCurrentPosition(p=> resolve({ lat:p.coords.latitude, lng:p.coords.longitude }), err=> reject(new Error('No se pudo obtener ubicación')), { enableHighAccuracy:true, timeout:10000 }) }) }

async function updateButtonStates(){
  try{
    const r = await api('api/timesheets/my')
    const startBtn = document.getElementById('startBtn')
    const breakStartBtn = document.getElementById('breakStartBtn')
    const breakEndBtn = document.getElementById('breakEndBtn')
    const endBtn = document.getElementById('endBtn')
    
    // Buscar jornada abierta de hoy
    const today = new Date().toISOString().split('T')[0]
    const openTimesheet = r.timesheets.find(t=> t.date === today && !t.end_time)
    
    if(!openTimesheet){
      // No hay jornada abierta: solo "Iniciar jornada" visible
      startBtn.style.display = 'inline-block'
      breakStartBtn.style.display = 'none'
      breakEndBtn.style.display = 'none'
      endBtn.style.display = 'none'
    } else if(openTimesheet.break_start && !openTimesheet.break_end){
      // Hay descanso iniciado: solo "Fin descanso" visible
      startBtn.style.display = 'none'
      breakStartBtn.style.display = 'none'
      breakEndBtn.style.display = 'inline-block'
      endBtn.style.display = 'none'
    } else {
      // Hay jornada abierta sin descanso: solo "Inicio descanso" y "Finalizar jornada" visibles
      startBtn.style.display = 'none'
      breakStartBtn.style.display = 'inline-block'
      breakEndBtn.style.display = 'none'
      endBtn.style.display = 'inline-block'
    }
  }catch(e){
    console.error('Error al actualizar estado de botones:', e)
  }
}

async function startDay(){ const msg=el('#geoMsg'); msg.textContent='Solicitando ubicación…'; try{ const loc=await getLocationOnce(); const r=await api('api/timesheets/start',{ method:'POST', body: JSON.stringify(loc)}); msg.textContent = r.within_radius? `Inicio OK (${r.distance_m} m)` : `Fuera de radio (${r.distance_m} m)`; loadTimesheets(); updateButtonStates(); }catch(e){ msg.textContent=e.message } }
async function endDay(){ const msg=el('#geoMsg'); msg.textContent='Solicitando ubicación…'; try{ const loc=await getLocationOnce(); const r=await api('api/timesheets/end',{ method:'POST', body: JSON.stringify(loc)}); msg.textContent = r.within_radius? `Fin OK (${r.distance_m} m). Horas: ${r.hours} (extra: ${r.overtime})` : `Fuera de radio (${r.distance_m} m). Horas: ${r.hours} (extra: ${r.overtime})`; loadTimesheets(); updateButtonStates(); }catch(e){ msg.textContent=e.message } }

async function breakStart(){ const msg=el('#geoMsg'); msg.textContent='Iniciando descanso…'; try{ const r=await api('api/timesheets/break/start',{ method:'POST', body: JSON.stringify({})}); msg.textContent = 'Descanso iniciado'; loadTimesheets(); updateButtonStates(); }catch(e){ msg.textContent=e.message } }

async function breakEnd(){ const msg=el('#geoMsg'); msg.textContent='Finalizando descanso…'; try{ const r=await api('api/timesheets/break/end',{ method:'POST', body: JSON.stringify({})}); msg.textContent = 'Descanso finalizado'; loadTimesheets(); updateButtonStates(); }catch(e){ msg.textContent=e.message } }

async function loadTimesheets(){
  const r = await api('api/timesheets/my'); const tbody=document.querySelector('#tsBody'); tbody.innerHTML=''; let totalExtra=0
  r.timesheets.forEach(t=>{ totalExtra+=t.overtime||0; const tr=document.createElement('tr'); tr.innerHTML = `<td>${ymdToDmy(t.date)}</td><td>${isoToHm(t.start_time)}</td><td>${t.break_start? isoToHm(t.break_start): ''}</td><td>${t.break_end? isoToHm(t.break_end): ''}</td><td>${t.end_time? isoToHm(t.end_time): ''}</td><td>${t.hours.toFixed(2)}</td><td>${t.overtime.toFixed(2)}</td>`; tbody.appendChild(tr) })
  // tarifa OT: intentar obtener desde perfil empleado (si no, fallback 15€/h).
  let rate = 15; try{ const meEmp = await api('api/employees/me'); rate = Number(meEmp.employee.overtime_rate) || rate }catch(e){};
  const total = totalExtra * rate; document.querySelector('#extraSummary').innerHTML = `Horas extra acumuladas: <b>${totalExtra.toFixed(2)}</b> • Precio por hora extra: <b>${fmtMoney(rate)}</b> • Total a cobrar: <b>${fmtMoney(total)}</b>`
}

async function saveTicket(){
  const amount=document.getElementById('tAmount').value, category=document.getElementById('tCat').value, file=document.getElementById('tFile').files[0]
  if(!file) return alert('Selecciona un archivo')
  const fd=new FormData(); if(amount) fd.append('amount', amount); fd.append('category', category); fd.append('file', file)
  const res = await fetch('api/tickets', { method:'POST', body: fd, credentials:'include' }); const data = await res.json().catch(()=>null)
  if(!res.ok) return alert(data?.error || 'Error al subir')
  alert('Ticket subido'); listTickets()
}
async function listTickets(){ const r=await api('api/tickets/my'); const tbody=document.querySelector('#tTable tbody'); tbody.innerHTML=''; r.tickets.forEach(t=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${new Date(t.created_at).toLocaleString()}</td><td>${t.category||'-'}</td><td>${fmtMoney(t.amount)}</td><td>${t.file_mime}</td><td>${t.status}${t.reason? ' ('+t.reason+')':''}</td>`; tbody.appendChild(tr) }) }

function toggleBreakFields(){
  const hasBreak = document.getElementById('reqHasBreak').checked
  const breakFields = document.getElementById('reqBreakFields')
  breakFields.style.display = hasBreak ? 'block' : 'none'
  if(!hasBreak){
    document.getElementById('reqBreakStart').value = ''
    document.getElementById('reqBreakEnd').value = ''
  }
}

async function loadDashboard(){
  const ts = await api('api/timesheets/my')
  const totalExtra = ts.timesheets.reduce((a,t)=> a + (t.overtime||0), 0)
  document.getElementById('dHours').textContent = totalExtra.toFixed(2)

  const tk = await api('api/tickets/my')
  const pend = tk.tickets.filter(t=> t.status==='PENDIENTE')
  const approved = tk.tickets.filter(t=> t.status==='APROBADO')
  const sumPend = pend.reduce((a,t)=> a + (t.amount||0), 0)
  const sumApproved = approved.reduce((a,t)=> a + (t.amount||0), 0)
  document.getElementById('dPend').textContent = ` ${fmtMoney(sumPend)}`
  document.getElementById('dApproved').textContent = ` ${fmtMoney(sumApproved)}`

  try{
    const meEmp = await api('api/employees/me')
    const totalDays = meEmp.employee.vacation_days ?? 22
    const usedDays = meEmp.employee.vacation_days_used ?? 0
    const availableDays = totalDays - usedDays
    document.getElementById('dVac').textContent = `${availableDays} días`
  }catch(e){
    document.getElementById('dVac').textContent = '—'
  }
}

async function saveRequest(){
  const date = document.getElementById('reqDate').value
  const startTime = document.getElementById('reqStartTime').value
  const endTime = document.getElementById('reqEndTime').value
  const hasBreak = document.getElementById('reqHasBreak').checked
  const breakStart = document.getElementById('reqBreakStart').value
  const breakEnd = document.getElementById('reqBreakEnd').value
  
  if(!date || !startTime || !endTime) return alert('Completa todos los campos')
  if(hasBreak && (!breakStart || !breakEnd)) return alert('Completa las horas de descanso')
  
  try{
    const payload = { date, start_time: startTime, end_time: endTime }
    if(hasBreak){
      payload.break_start = breakStart
      payload.break_end = breakEnd
    }
    const r = await api('api/timesheets/requests', { method:'POST', body: JSON.stringify(payload)})
    alert('Solicitud creada')
    document.getElementById('reqDate').value = ''
    document.getElementById('reqStartTime').value = ''
    document.getElementById('reqEndTime').value = ''
    document.getElementById('reqHasBreak').checked = false
    document.getElementById('reqBreakStart').value = ''
    document.getElementById('reqBreakEnd').value = ''
    toggleBreakFields()
    loadRequests()
  }catch(e){
    alert(e.message)
  }
}

async function loadRequests(){
  try{
    const r = await api('api/timesheets/requests/my')
    const tbody = document.querySelector('#reqBody')
    tbody.innerHTML = ''
    // Filtrar solo las pendientes y rechazadas (las aceptadas se muestran en "Mis jornadas")
    const pendingOrRejected = r.requests.filter(req => req.status !== 'ACEPTADO')
    pendingOrRejected.forEach(req=>{
      const tr = document.createElement('tr')
      const statusColor = req.status === 'RECHAZADO' ? 'red' : 'orange'
      tr.innerHTML = `<td>${ymdToDmy(req.date)}</td><td>${req.start_time}</td><td>${req.end_time}</td><td>${!req.break_start ? '—' : req.break_start}</td><td>${!req.break_end ? '—' : req.break_end}</td><td style="color:${statusColor}">${req.status}</td><td>${req.reason || ''}</td>`
      tbody.appendChild(tr)
    })
    // Recargar también las jornadas y el dashboard para mostrar las solicitudes aceptadas
    loadTimesheets()
    loadDashboard()
  }catch(e){
    console.error('Error al cargar solicitudes:', e)
  }
}

async function saveVacation(){
  const startDate = document.getElementById('vacStart').value
  const endDate = document.getElementById('vacEnd').value
  
  if(!startDate || !endDate){
    alert('Selecciona las fechas de inicio y fin')
    return
  }
  
  try{
    const r = await api('api/vacations', { method:'POST', body: JSON.stringify({ start_date: startDate, end_date: endDate })})
    alert('Solicitud de vacaciones creada')
    document.getElementById('vacStart').value = ''
    document.getElementById('vacEnd').value = ''
    loadVacations()
  }catch(e){
    alert(e.message)
  }
}

async function loadVacations(){
  try{
    const r = await api('api/vacations/my')
    const tbody = document.querySelector('#vacBody')
    tbody.innerHTML = ''
    r.requests.forEach(req=>{
      const tr = document.createElement('tr')
      const start = new Date(req.start_date)
      const end = new Date(req.end_date)
      const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1
      const statusColor = req.status === 'RECHAZADO' ? 'red' : req.status === 'ACEPTADO' ? 'green' : 'orange'
      tr.innerHTML = `<td>${ymdToDmy(req.start_date)}</td><td>${ymdToDmy(req.end_date)}</td><td>${days}</td><td style="color:${statusColor}">${req.status}</td><td>${req.reason || ''}</td>`
      tbody.appendChild(tr)
    })
  }catch(e){
    console.error('Error al cargar vacaciones:', e)
  }
}

