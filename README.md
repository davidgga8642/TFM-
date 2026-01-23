# TFM - Gestor de Jornadas, Gastos y Vacaciones

Sistema completo de gestión empresarial con control de horarios, gastos de empleados y solicitudes de vacaciones.

## 🚀 Características

### Para Empleados (Workers)
- **Control de horario**: Fichaje con geolocalización
- **Descansos**: Registrar inicio y fin de descanso
- **Solicitudes de jornada**: Solicitar jornadas manuales al administrador
- **Gestión de gastos**: Subir tickets de gastos (dietas, transporte, alojamiento)
- **Solicitudes de vacaciones**: Solicitar vacaciones con rango de fechas
- **Dashboard**: Seguimiento de horas extra, gastos pendientes/aprobados y vacaciones disponibles

### Para Administradores
- **Gestión de empleados**: Crear, editar y ver empleados
- **Aprobación de jornadas**: Revisar y aprobar solicitudes de jornada manual
- **Revisión de gastos**: Aprobar o rechazar gastos de empleados con descarga de PDFs/imágenes
- **Gestión de vacaciones**: Aprobar o rechazar solicitudes de vacaciones
- **Dashboard financiero**: Análisis de ingresos, gastos y beneficios
- **Reportes**: Gráficos de horas extra acumuladas

## 📋 Requisitos

- Node.js v18+
- npm 9+

## 🛠️ Instalación

1. Clonar el repositorio:
```bash
git clone https://github.com/davidgga8642/TFM-.git
cd TFM-
```

2. Instalar dependencias del backend:
```bash
cd backend
npm install
```

3. Arrancar el servidor:
```bash
npm start
```

4. Acceder a la aplicación:
```
http://localhost:3000
```

## 📁 Estructura del Proyecto

```
TFM-/
├── backend/                      # API Node.js/Express
│   ├── db.js                    # Inicialización BD SQLite
│   ├── server.js                # Servidor principal
│   ├── middleware.js            # Autenticación y autorización
│   ├── routes-auth.js           # Endpoints de autenticación
│   ├── routes-company.js        # Gestión de empresa y empleados
│   ├── routes-timesheets.js     # Control de horario y jornadas
│   ├── routes-tickets.js        # Gestión de gastos
│   ├── routes-vacations.js      # Solicitudes de vacaciones
│   ├── routes-finance.js        # Análisis financiero
│   └── package.json
│
├── frontend/                     # Cliente web (Vanilla JS/HTML/CSS)
│   ├── index.html               # Página de login
│   ├── admin.html               # Panel administrador
│   ├── employee.html            # Panel empleado
│   ├── admin-employee-new.html  # Crear empleado
│   ├── js/
│   │   ├── admin.js             # Lógica admin
│   │   ├── employee.js          # Lógica empleado
│   │   └── common.js            # Funciones compartidas
│   └── css/
│       └── styles.css           # Estilos
│
├── docs/                        # Documentación
└── README.md
```

## 🔐 Autenticación

### Usuarios Demo

**Admin:**
- Email: `admin@empresa.com`
- Contraseña: `admin123`

**Empleado:**
- Email: `worker@empresa.com`
- Contraseña: `worker123`

## 📊 Base de Datos

SQLite3 con las siguientes tablas principales:
- `users`: Autenticación y roles
- `employees`: Datos de empleados y permisos
- `timesheets`: Registro de jornadas
- `timesheet_requests`: Solicitudes de jornada
- `tickets`: Gastos de empleados
- `vacation_requests`: Solicitudes de vacaciones
- `finance_entries`: Registros financieros

## 🔑 Características Principales

### Sistema de Vacaciones
- Validación de días disponibles (22 días por defecto)
- Reseteo automático cada año
- Cálculo automático de días solicitados
- Aprobación/rechazo por administrador

### Control de Horario
- Geolocalización para fichaje
- Radio de validación de 200m
- Registro de descansos
- Cálculo automático de horas extra

### Gestión de Gastos
- Categorías con permisos por empleado (dietas, transporte, alojamiento)
- Validación de importes
- Descarga de archivos adjuntos (PDF/IMG)
- Estado de aprobación

## 🚀 Despliegue

### Producción
```bash
cd backend
npm install --production
NODE_ENV=production node server.js
```

## 📝 Stack Tecnológico

- **Frontend**: HTML5, CSS3, JavaScript (ES6+) - Vanilla (sin frameworks)
- **Backend**: Node.js, Express.js
- **Base de datos**: SQLite3
- **Autenticación**: express-session, bcrypt
- **Gráficos**: Chart.js
- **Carga de archivos**: Multer
- **Versionado**: Git

## 📝 Licencia

Proyecto académico TFM

## 👤 Autor

David García García

---

**Repositorio:** https://github.com/davidgga8642/TFM-

---

## 🗓️ Cambios recientes (23-01-2026)
David Gómez García-Arias
### Qué se ha cambiado
- Dashboard KPIs:
	- Ingresos totales: ahora suman el importe de las facturas emitidas.
	- Gastos: ahora suman salarios de empleados activos + gastos aprobados.
	- Resultado neto: ingresos − gastos.
- Gráfico "Ingresos vs Gastos":
	- Ingresos por mes: suma de facturas del mes.
	- Gastos por mes: salarios de empleados activos en ese mes + gastos aprobados del mes.
- Gráfico "Horas extra acumuladas":
	- Se calcula por empleado y por mes las horas extra (horas trabajadas − horas diarias contratadas), restando tiempo de descanso.
- Cifrado de tickets (PDF/imagenes):
	- Cifrado en reposo (AES-256-GCM) al subir.
	- Descifrado bajo demanda solo para usuarios ADMIN/CEO.
	- Compatibilidad con archivos antiguos sin cifrar.
- Solicitudes de jornada: campos opcionales de descanso (`break_start`, `break_end`) y visualización en admin/empleado.

### Cómo se ha implementado
- Backend
	- `backend/routes-finance.js`:
		- Se corrige el cálculo de horas extra utilizando timestamps ISO (`start_time`, `end_time`, `break_start`, `break_end`) y se computa el exceso sobre `daily_hours` por día, agregando por empleado/mes.
		- Se expone `series.overtime_by_employee` y `series.invoice_incomes` para el frontend.
	- `backend/routes-tickets.js`:
		- Se añade cifrado al subir archivos con AES-256-GCM; se guarda `.enc` y se elimina el archivo en claro.
		- El endpoint de descarga descifra en memoria para ADMIN/CEO y mantiene fallback para archivos en claro anteriores.
	- `backend/db.js`:
		- Se asegura la existencia de columnas `break_start` y `break_end` en `timesheet_requests`.
		- Se añaden columnas `hire_date` y `termination_date` en `employees` para poder computar salarios por mes según actividad.
- Frontend
	- `frontend/js/admin.js`:
		- KPIs: ingresos = facturas; gastos = salarios activos + tickets aprobados; neto = ingresos − gastos.
		- Gráfico ch1: ingresos/gastos mensuales calculados desde invoices/tickets + salarios activos por mes.
		- Gráfico ch3: series por empleado/mes con horas extra.
	- `frontend/admin.html` y `frontend/employee.html`:
		- Columnas de descanso visibles en tablas de solicitudes.

### Notas de operación
- Acceso a PDFs de gastos:
	- Solo ADMIN/CEO puede descargar mediante `GET /api/tickets/:id/file`.
	- Archivos nuevos están cifrados; los antiguos se sirven de forma segura solo para ADMIN.
- Para ver el dashboard actualizado:
	- Iniciar backend (`npm start`) y acceder a `http://localhost:3000/admin.html`.
	- Usar usuario ADMIN/CEO para acceder a gastos y gráficas financieras.

