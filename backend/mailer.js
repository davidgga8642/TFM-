import nodemailer from 'nodemailer'

// Configuración SMTP de ejemplo (puedes cambiar a tu servidor real)
// Para desarrollo, se usa un servicio de prueba Ethereal
let transporter = null

export async function initMailer(){
  // En producción, usa variables de entorno
  if(process.env.SMTP_HOST){
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    })
  } else {
    // Crear cuenta de prueba Ethereal para desarrollo
    const testAccount = await nodemailer.createTestAccount()
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      }
    })
    console.log('📧 Usando Ethereal para pruebas. Vista previa de emails:', testAccount.web)
  }
}

export async function sendResetEmail(email, resetToken, resetLink){
  if(!transporter) await initMailer()
  
  const mailOptions = {
    from: process.env.SMTP_FROM || 'noreply@tfm-empresas.com',
    to: email,
    subject: 'Recuperar contraseña - TFM Empresas',
    html: `
      <h2>Recuperar contraseña</h2>
      <p>Has solicitado recuperar tu contraseña en TFM Empresas.</p>
      <p>Haz clic en el siguiente enlace para establecer una nueva contraseña:</p>
      <a href="${resetLink}" style="display:inline-block; padding:10px 20px; background-color:#007bff; color:white; text-decoration:none; border-radius:4px;">
        Cambiar contraseña
      </a>
      <p>O copia y pega este enlace en tu navegador:</p>
      <p>${resetLink}</p>
      <p><strong>Este enlace expira en 1 hora.</strong></p>
      <p>Si no solicitaste esto, ignora este email.</p>
      <hr/>
      <p style="font-size:12px; color:#666;">TFM Empresas - Sistema de Gestión</p>
    `
  }
  
  try{
    const info = await transporter.sendMail(mailOptions)
    console.log('✅ Email enviado:', info.messageId)
    
    // Si es Ethereal (desarrollo), devolver URL de vista previa
    if(process.env.NODE_ENV !== 'production' && !process.env.SMTP_HOST){
      const previewUrl = nodemailer.getTestMessageUrl(info)
      return { success: true, preview_url: previewUrl }
    }
    return { success: true }
  } catch(err){
    console.error('❌ Error al enviar email:', err)
    throw new Error('No se pudo enviar el email')
  }
}
