import { api, me, fmtMoney, el } from './common.js'

const who = el('#who')
const tabs = document.querySelectorAll('.tab')
const sections = {
  dashboard: document.querySelector('#tab-dashboard'),
  employees: document.querySelector('#tab-employees'),
  invoices: document.querySelector('#tab-invoices'),
  expenses: document.querySelector('#tab-expenses'),
  requests: document.querySelector('#tab-requests'),
  vacations: document.querySelector('#tab-vacations'),
  company: document.querySelector('#tab-company')
}
tabs.forEach(t=> t.addEventListener('click', ()=> activateTab(t.dataset.tab)))
function activateTab(id){
  tabs.forEach(t=> t.classList.toggle('active', t.dataset.tab===id))
  for(const k in sections){ sections[k].style.display = (k===id)? 'block':'none' }
  if(id==='expenses') listExpenses()
  if(id==='requests') loadRequests()
  if(id==='vacations'){ loadVacationRequests(); loadAcceptedVacations(); initVacationCalendar() }
  if(id==='invoices') listInvoices()
}

async function init(){
  const user = await me(); if(!user || user.role!=='ADMIN'){ location.href='index.html'; return }
  who.textContent = `${user.email} • ADMIN`
  loadChartsAndKpis()
  listEmployees()
  el('#cSave').addEventListener('click', saveCompany)
  loadCompany()
  el('#invSave').addEventListener('click', saveInvoice)
  setupEmployeeSearch()
  setupExportModal()
}
init().catch(e=> alert(e.message))

// --- Employee search and pagination ---
let allEmployees = []
let empCurrentPage = 1
const empPageSize = 15

function setupEmployeeSearch(){
  el('#empSearchBtn').addEventListener('click', ()=>{ empCurrentPage = 1; renderEmployees() })
  el('#empSearch').addEventListener('keyup', ()=>{ empCurrentPage = 1; renderEmployees() })
  el('#empPrevBtn').addEventListener('click', ()=>{ if(empCurrentPage > 1) empCurrentPage--; renderEmployees() })
  el('#empNextBtn').addEventListener('click', ()=>{ const totalPages = Math.ceil(getFilteredEmployees().length / empPageSize); if(empCurrentPage < totalPages) empCurrentPage++; renderEmployees() })
}

function getFilteredEmployees(){
  const query = el('#empSearch').value.toLowerCase().trim()
  return allEmployees.filter(e=> !query || e.email.toLowerCase().includes(query))
}

function renderEmployees(){
  const filtered = getFilteredEmployees()
  const totalPages = Math.ceil(filtered.length / empPageSize)
  if(empCurrentPage > totalPages) empCurrentPage = Math.max(1, totalPages)
  
  const start = (empCurrentPage - 1) * empPageSize
  const end = start + empPageSize
  const pageEmployees = filtered.slice(start, end)
  
  const tbody = document.querySelector('#empTable tbody')
  tbody.innerHTML = ''
  
  pageEmployees.forEach(e=>{
    const tr = document.createElement('tr')
    tr.innerHTML = `<td>${e.email}</td><td>${fmtMoney(e.overtime_rate)}</td><td>${fmtMoney(e.salary)}</td><td>${e.allow_diets?'Dietas':''} ${e.allow_transport?'Transporte':''}</td><td>${e.active? 'Activo':'Baja'}</td>`
    const tdAct = document.createElement('td')
    if(e.active){
      const btn = document.createElement('button')
      btn.className = 'btn'
      btn.textContent = 'Dar de baja'
      btn.onclick = async ()=>{
        if(!confirm('¿Desactivar este usuario?')) return
        await deactivateEmployee(e.id)
        listEmployees()
      }
      tdAct.appendChild(btn)
    } else {
      const btn = document.createElement('button')
      btn.className = 'btn'
      btn.textContent = 'Dar de alta'
      btn.onclick = async ()=>{
        await activateEmployee(e.id)
        listEmployees()
      }
      tdAct.appendChild(btn)
    }
    tr.appendChild(tdAct)
    tbody.appendChild(tr)
  })
  
  el('#empPageInfo').textContent = `Página ${empCurrentPage} de ${totalPages || 1}`
  el('#empPrevBtn').disabled = empCurrentPage <= 1
  el('#empNextBtn').disabled = empCurrentPage >= totalPages
}

async function listEmployees(){
  const r = await api('api/employees')
  allEmployees = r.employees
  empCurrentPage = 1
  renderEmployees()
}

async function deactivateEmployee(empId){
  await api('api/employees/'+empId+'/deactivate', { method:'PATCH', body: JSON.stringify({}) })
  alert('Usuario desactivado')
}

async function activateEmployee(empId){
  await api('api/employees/'+empId+'/activate', { method:'PATCH', body: JSON.stringify({}) })
  alert('Usuario activado')
}

async function loadCompany(){
  const r = await api('api/company')
  el('#cLat').value = r.company.lat
  el('#cLng').value = r.company.lng
}
async function saveCompany(){
  const lat = Number(el('#cLat').value), lng = Number(el('#cLng').value)
  if(!Number.isFinite(lat) || !Number.isFinite(lng)) return alert('Coordenadas inválidas')
  await api('api/company/location', { method:'POST', body: JSON.stringify({lat,lng}) })
  alert('Guardado')
}

async function loadChartsAndKpis(){
  const r = await api('api/finance/summary')
  const { months, series } = r
  
  // Calculate KPIs
  // Ingresos totales = suma de facturas emitidas
  const invR = await api('api/invoices')
  const inc = invR.invoices.reduce((sum, inv) => sum + (inv.amount || 0), 0)
  
  // Gastos = salarios empleados + gastos aceptados
  const empR = await api('api/employees')
  const ticketsR = await api('api/tickets/all?status=APROBADO')
  
  // Calcular gastos totales considerando empleados activos actualmente
  const activeSalaries = empR.employees.filter(e => e.active).reduce((sum, e) => sum + (e.salary || 0), 0)
  const approvedExpenses = ticketsR.tickets.reduce((sum, t) => sum + (t.amount || 0), 0)
  const exp = activeSalaries + approvedExpenses
  
  // Resultado neto
  const net = inc - exp
  
  el('#kpiInc').textContent = fmtMoney(inc)
  el('#kpiExp').textContent = fmtMoney(exp)
  el('#kpiNet').textContent = fmtMoney(net)

  // Build monthly data for ch1 (Ingresos vs Gastos)
  const monthlyInvoices = {}
  const monthlyTickets = {}
  months.forEach(m => { monthlyInvoices[m] = 0; monthlyTickets[m] = 0 })
  
  invR.invoices.forEach(inv => {
    const month = inv.month || new Date(inv.created_at).toISOString().slice(0,7)
    if(months.includes(month)) monthlyInvoices[month] += inv.amount || 0
  })
  
  ticketsR.tickets.forEach(t => {
    const month = new Date(t.created_at).toISOString().slice(0,7)
    if(months.includes(month)) monthlyTickets[month] += t.amount || 0
  })
  
  // Calcular gastos por mes: salarios de empleados activos ese mes + gastos ese mes
  const monthlyExpenses = months.map(monthStr => {
    // Suma de salarios de empleados activos en este mes
    const monthlySalaries = empR.employees
      .filter(e => {
        // Si no tiene hire_date, asumir que fue contratado en el primer mes disponible
        const hireMonth = e.hire_date ? e.hire_date.slice(0,7) : months[0]
        // Si tiene termination_date, verificar que el mes sea antes de la terminación
        const termMonth = e.termination_date ? e.termination_date.slice(0,7) : null
        
        const isActive = hireMonth <= monthStr && (!termMonth || monthStr < termMonth)
        return isActive && e.active
      })
      .reduce((sum, e) => sum + (e.salary || 0), 0)
    
    return monthlySalaries + (monthlyTickets[monthStr] || 0)
  })
  
  const monthlyIncome = months.map(m => monthlyInvoices[m] || 0)
  
  if(window._ch1) window._ch1.destroy(); if(window._ch2) window._ch2.destroy(); if(window._ch3) window._ch3.destroy();
  const c1 = document.getElementById('ch1').getContext('2d')
  window._ch1 = new Chart(c1, { type:'bar', data:{ labels:months, datasets:[ {label:'Ingresos (facturas)', data:monthlyIncome}, {label:'Gastos (salarios + tickets)', data:monthlyExpenses} ] }, options:{ responsive:true } })
  const c2 = document.getElementById('ch2').getContext('2d')
  window._ch2 = new Chart(c2, { type:'line', data:{ labels:months, datasets:[ {label:'Beneficio bruto', data:series.gross}, {label:'Impuestos estimados', data:series.taxes}, {label:'Resultado neto', data:series.net} ] }, options:{ responsive:true } })
  const c3 = document.getElementById('ch3').getContext('2d')
  const otByEmp = series.overtime_by_employee || []
  const empNames = Array.from(new Set(otByEmp.map(o=>o.email))).sort()
  const otDatasets = empNames.map(name=>({ label:name, data: months.map(m=>{
    const found = otByEmp.find(o=>o.email===name && o.month===m)
    return found ? found.hours : 0
  }) }))
  window._ch3 = new Chart(c3, {
    type:'bar',
    data:{ labels:months, datasets: otDatasets },
    options:{ responsive:true, plugins:{ tooltip:{ mode:'index', intersect:false } }, scales:{ x:{ stacked:true }, y:{ stacked:true } } }
  })
}

// --- Expenses review (admin) ---
document.getElementById('expLoad').addEventListener('click', listExpenses)
document.getElementById('expFilter').addEventListener('change', listExpenses)
async function listExpenses(){
  const status = document.getElementById('expFilter').value
  const q = status ? ('?status='+encodeURIComponent(status)) : ''
  const r = await api('api/tickets/all'+q)
  const tbody = document.querySelector('#expTable tbody'); tbody.innerHTML = ''
  r.tickets.forEach(t=>{
    const tr = document.createElement('tr')
    tr.innerHTML = `<td>${t.id}</td><td>${new Date(t.created_at).toLocaleString()}</td><td>${t.email}</td><td>${t.category||'-'}</td><td>${fmtMoney(t.amount)}</td><td>${t.status}</td>`
    
    const tdPdf = document.createElement('td')
    const btnPdf = document.createElement('a')
    btnPdf.className = 'btn'
    btnPdf.textContent = 'Ver PDF'
    btnPdf.href = 'api/tickets/'+t.id+'/file'
    btnPdf.target = '_blank'
    tdPdf.appendChild(btnPdf)
    tr.appendChild(tdPdf)
    
    const td = document.createElement('td')
    const btnA = document.createElement('button'); btnA.className='btn btn-approve'; btnA.textContent='Aprobar'; btnA.onclick = async ()=>{ await api('api/tickets/'+t.id+'/approve', { method:'PATCH', body: JSON.stringify({}) }); document.getElementById('expFilter').value='PENDIENTE'; listExpenses() }
    const inp = document.createElement('input'); inp.className='input'; inp.placeholder='Motivo rechazo'; inp.style.maxWidth='200px'
    const btnR = document.createElement('button'); btnR.className='btn btn-reject'; btnR.textContent='Rechazar'; btnR.onclick = async ()=>{ if(!inp.value) return alert('Motivo requerido'); await api('api/tickets/'+t.id+'/reject', { method:'PATCH', body: JSON.stringify({ reason: inp.value }) }); document.getElementById('expFilter').value='PENDIENTE'; listExpenses() }
    td.append(btnR, inp, btnA); tr.appendChild(td)
    tbody.appendChild(tr)
  })

  // Load approved expenses table
  const ra = await api('api/tickets/all?status=APROBADO')
  const tbodyA = document.querySelector('#expApprovedTable tbody'); tbodyA.innerHTML = ''
  ra.tickets.forEach(t=>{
    const tr = document.createElement('tr')
    tr.innerHTML = `<td>${t.id}</td><td>${new Date(t.created_at).toLocaleString()}</td><td>${t.email}</td><td>${t.category||'-'}</td><td>${fmtMoney(t.amount)}</td>`
    const tdPdf = document.createElement('td')
    const btnPdf = document.createElement('a')
    btnPdf.className = 'btn'
    btnPdf.textContent = 'Ver PDF'
    btnPdf.href = 'api/tickets/'+t.id+'/file'
    btnPdf.target = '_blank'
    tdPdf.appendChild(btnPdf)
    tr.appendChild(tdPdf)
    tbodyA.appendChild(tr)
  })
}

async function loadRequests(){
  try{
    const r = await api('api/timesheets/requests/pending')
    const tbody = document.querySelector('#reqTable tbody')
    tbody.innerHTML = ''
    r.requests.forEach(req=>{
      const tr = document.createElement('tr')
      const breakStart = req.break_start || req.break_start === null ? '—' : req.break_start
      const breakEnd = req.break_end || req.break_end === null ? '—' : req.break_end
      tr.innerHTML = `<td>${req.email}</td><td>${req.date}</td><td>${req.start_time}</td><td>${req.end_time}</td><td>${!req.break_start ? '—' : req.break_start}</td><td>${!req.break_end ? '—' : req.break_end}</td><td>${new Date(req.created_at).toLocaleString()}</td>`
      const td = document.createElement('td')
      const btnA = document.createElement('button')
      btnA.className = 'btn btn-approve'
      btnA.textContent = 'Aceptar'
      btnA.onclick = async ()=>{
        await api('api/timesheets/requests/'+req.id+'/approve', { method:'POST', body: JSON.stringify({}) })
        alert('Solicitud aceptada')
        loadRequests()
      }
      const inp = document.createElement('input')
      inp.className = 'input'
      inp.placeholder = 'Motivo rechazo'
      inp.style.maxWidth = '200px'
      const btnR = document.createElement('button')
      btnR.className = 'btn btn-reject'
      btnR.textContent = 'Rechazar'
      btnR.onclick = async ()=>{
        if(!inp.value) return alert('Motivo requerido')
        await api('api/timesheets/requests/'+req.id+'/reject', { method:'POST', body: JSON.stringify({ reason: inp.value }) })
        alert('Solicitud rechazada')
        loadRequests()
      }
      td.append(btnR, inp, btnA)
      tr.appendChild(td)
      tbody.appendChild(tr)
    })
  }catch(e){
    console.error('Error al cargar solicitudes:', e)
  }
}

async function loadVacationRequests(){
  try{
    const r = await api('api/vacations/pending')
    const tbody = document.querySelector('#vacTable tbody')
    tbody.innerHTML = ''
    r.requests.forEach(req=>{
      const tr = document.createElement('tr')
      const start = new Date(req.start_date)
      const end = new Date(req.end_date)
      const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1
      tr.innerHTML = `<td>${req.email}</td><td>${req.start_date}</td><td>${req.end_date}</td><td>${days}</td><td>${new Date(req.created_at).toLocaleString()}</td>`
      const td = document.createElement('td')
      const btnA = document.createElement('button')
      btnA.className = 'btn'
      btnA.textContent = 'Aceptar'
      btnA.onclick = async ()=>{
        await api('api/vacations/'+req.id+'/approve', { method:'POST', body: JSON.stringify({}) })
        alert('Vacaciones aprobadas')
        loadVacationRequests()
        loadAcceptedVacations()
      }
      const inp = document.createElement('input')
      inp.className = 'input'
      inp.placeholder = 'Motivo rechazo'
      inp.style.maxWidth = '200px'
      const btnR = document.createElement('button')
      btnR.className = 'btn'
      btnR.textContent = 'Rechazar'
      btnR.onclick = async ()=>{
        if(!inp.value) return alert('Motivo requerido')
        await api('api/vacations/'+req.id+'/reject', { method:'POST', body: JSON.stringify({ reason: inp.value }) })
        alert('Vacaciones rechazadas')
        loadVacationRequests()
      }
      td.append(btnA, inp, btnR)
      tr.appendChild(td)
      tbody.appendChild(tr)
    })
  }catch(e){
    console.error('Error al cargar solicitudes de vacaciones:', e)
  }
}

async function loadAcceptedVacations(){
  try{
    const r = await api('api/vacations/accepted')
    const tbody = document.querySelector('#vacAcceptedTable tbody')
    tbody.innerHTML = ''
    r.requests.forEach(req=>{
      const tr = document.createElement('tr')
      const start = new Date(req.start_date)
      const end = new Date(req.end_date)
      const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1
      tr.innerHTML = `<td>${req.email}</td><td>${req.start_date}</td><td>${req.end_date}</td><td>${days}</td>`
      tbody.appendChild(tr)
    })
  }catch(e){
    console.error('Error al cargar vacaciones aceptadas:', e)
  }
}

async function listInvoices(){
  const res = await fetch('api/invoices', { credentials:'include' })
  if(!res.ok){ const err = await res.json().catch(()=>({error:'Error'})); alert(err.error||'Error al listar facturas'); return }
  const r = await res.json()
  const tbody = document.querySelector('#invTable tbody')
  tbody.innerHTML = ''
  r.invoices.forEach(inv=>{
    const tr = document.createElement('tr')
    tr.innerHTML = `<td>${inv.client_name}</td><td>${inv.month}</td><td>${fmtMoney(inv.amount)}</td><td>${new Date(inv.created_at).toLocaleString()}</td>`
    const tdPdf = document.createElement('td')
    const link = document.createElement('a')
    link.href = 'api/invoices/'+inv.id+'/file'
    link.target = '_blank'
    link.textContent = 'Ver PDF'
    tdPdf.appendChild(link)
    tr.appendChild(tdPdf)
    tbody.appendChild(tr)
  })
}

async function saveInvoice(){
  const client = el('#invClient').value.trim()
  const amount = Number(el('#invAmount').value)
  const month = el('#invMonth').value
  const file = el('#invFile').files[0]
  if(!client || !month || !Number.isFinite(amount) || !file) return alert('Completa cliente, mes, importe y PDF')
  const fd = new FormData()
  fd.append('client_name', client)
  fd.append('amount', amount)
  fd.append('month', month)
  fd.append('file', file)
  const res = await fetch('api/invoices', { method:'POST', body: fd, credentials:'include' })
  if(!res.ok){ const err = await res.json().catch(()=>({error:'Error'})); return alert(err.error || 'Error al guardar') }
  el('#invClient').value = ''
  el('#invAmount').value = ''
  el('#invMonth').value = ''
  el('#invFile').value = ''
  await listInvoices()
  await loadChartsAndKpis()
  alert('Factura guardada')
}

// --- Export employee data to Excel ---
function setupExportModal(){
  el('#exportInfoBtn').addEventListener('click', showExportModal)
  el('#exportCancelBtn').addEventListener('click', ()=> el('#exportModal').style.display = 'none')
  el('#exportConfirmBtn').addEventListener('click', generateExcel)
}

function showExportModal(){
  const modal = el('#exportModal')
  const list = el('#exportEmployeeList')
  list.innerHTML = ''
  
  allEmployees.forEach(emp=>{
    const div = document.createElement('div')
    div.className = 'checkbox-item'
    div.innerHTML = `
      <input type="checkbox" id="emp-${emp.id}" value="${emp.id}">
      <label for="emp-${emp.id}">${emp.email}</label>
    `
    list.appendChild(div)
  })
  
  modal.style.display = 'flex'
}

async function generateExcel(){
  const checkboxes = document.querySelectorAll('#exportEmployeeList input[type="checkbox"]:checked')
  if(checkboxes.length === 0){
    alert('Selecciona al menos un empleado')
    return
  }
  
  const employeeIds = Array.from(checkboxes).map(cb=> cb.value)
  
  // Obtener datos del backend
  const results = await Promise.all(
    employeeIds.map(id=> api(`api/employees/${id}/stats`))
  )
  
  // Crear datos para Excel
  const data = [
    ['', 'Dias trabajados', 'Total gastos', 'Dias libres', 'Tickets aceptados', 'Tickets rechazados']
  ]
  
  results.forEach(stat=>{
    data.push([
      stat.email,
      stat.days_worked,
      `€${stat.total_expenses.toFixed(2)}`,
      stat.vacation_days,
      stat.tickets_approved,
      stat.tickets_rejected
    ])
  })
  
  // Generar Excel
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(data)
  XLSX.utils.book_append_sheet(wb, ws, 'Estadísticas')
  XLSX.writeFile(wb, `empleados_${new Date().toISOString().split('T')[0]}.xlsx`)
  
  el('#exportModal').style.display = 'none'
  alert('Excel generado correctamente')
}

// --- Vacation Calendar ---
const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#ec4899', '#14b8a6']
let employeeColors = {}
let calendarInstance = null

function getEmployeeColor(email){
  if(!employeeColors[email]){
    const colorIndex = Object.keys(employeeColors).length % colors.length
    employeeColors[email] = colors[colorIndex]
  }
  return employeeColors[email]
}

async function initVacationCalendar(){
  const calendarEl = document.getElementById('vacationCalendar')
  if(!calendarEl) {
    console.error('Contenedor del calendario no encontrado')
    return
  }
  
  // Limpiar eventos previos
  employeeColors = {}
  
  try {
    console.log('Cargando vacaciones aceptadas...')
    const res = await api('api/vacations/accepted')
    const vacations = res.requests || []
    console.log('Vacaciones cargadas:', vacations)
    
    // Crear eventos para el calendario
    const events = vacations.map(vac => {
      const color = getEmployeeColor(vac.email)
      const startDate = vac.start_date
      const endDate = new Date(new Date(vac.end_date).getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      console.log(`Evento: ${vac.email} de ${startDate} a ${endDate}`)
      return {
        title: vac.email,
        start: startDate,
        end: endDate,
        backgroundColor: color,
        borderColor: color,
        textColor: '#fff',
        extendedProps: {
          email: vac.email
        }
      }
    })
    
    // Destruir calendario anterior si existe
    if(calendarInstance){
      calendarInstance.destroy()
    }
    
    // Limpiar el contenedor
    calendarEl.innerHTML = ''
    
    // Crear nuevo calendario
    console.log('Inicializando FullCalendar con', events.length, 'eventos')
    calendarInstance = new FullCalendar.Calendar(calendarEl, {
      initialView: 'dayGridMonth',
      locale: 'es',
      height: 'auto',
      contentHeight: 'auto',
      events: events,
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,dayGridWeek'
      },
      eventClick: function(info){
        alert(`${info.event.title}\n${info.event.start.toLocaleDateString()} - ${new Date(info.event.end.getTime() - 1).toLocaleDateString()}`)
      }
    })
    
    calendarInstance.render()
    console.log('Calendario renderizado exitosamente')
  } catch(e) {
    console.error('Error loading vacation calendar:', e)
    alert('Error cargando calendario: ' + e.message)
  }
}

