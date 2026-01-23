import nodemailer from 'nodemailer'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const etherealCredsFile = path.join(__dirname, '.ethereal-creds.json')

let transporter = null
let etherealCreds = null

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
    let testAccount
    
    // Intentar cargar credenciales guardadas
    if(fs.existsSync(etherealCredsFile)){
      try{
        const saved = JSON.parse(fs.readFileSync(etherealCredsFile, 'utf-8'))
        testAccount = saved
        console.log('📧 Usando cuenta Ethereal guardada')
      }catch(e){
        testAccount = await nodemailer.createTestAccount()
        fs.writeFileSync(etherealCredsFile, JSON.stringify(testAccount, null, 2))
      }
    } else {
      testAccount = await nodemailer.createTestAccount()
      fs.writeFileSync(etherealCredsFile, JSON.stringify(testAccount, null, 2))
    }
    
    etherealCreds = testAccount
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      }
    })
    
    console.log('')
    console.log('╔════════════════════════════════════════════════════════════╗')
    console.log('║         📧 CONFIGURACIÓN DE ETHEREAL PARA PRUEBAS          ║')
    console.log('╠════════════════════════════════════════════════════════════╣')
    console.log('║ Email: ' + testAccount.user)
    console.log('║ Contraseña: ' + testAccount.pass)
    console.log('║ URL: https://ethereal.email/login')
    console.log('╠════════════════════════════════════════════════════════════╣')
    console.log('║ Los emails aparecerán en tu bandeja de entrada de Ethereal ║')
    console.log('╚════════════════════════════════════════════════════════════╝')
    console.log('')
  }
}

export async function sendResetEmail(email, resetToken, resetLink){
  if(!transporter) await initMailer()
  
  const mailOptions = {
    from: process.env.SMTP_FROM || 'noreply@tfm-empresas.com',
    to: email,
    subject: 'Recuperar contraseña - TFM Empresas',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #007bff;">Recuperar contraseña</h2>
        <p>Has solicitado recuperar tu contraseña en TFM Empresas.</p>
        <p>Haz clic en el siguiente enlace para establecer una nueva contraseña:</p>
        <p style="margin: 20px 0;">
          <a href="${resetLink}" style="display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 4px; font-weight: bold;">
            Cambiar contraseña
          </a>
        </p>
        <p style="color: #666;">O copia y pega este enlace en tu navegador:</p>
        <p style="word-break: break-all; color: #666;"><code>${resetLink}</code></p>
        <p><strong>Este enlace expira en 1 hora.</strong></p>
        <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
        <p style="color: #999; font-size: 12px;">Si no solicitaste esto, ignora este email.</p>
        <p style="color: #999; font-size: 12px;">TFM Empresas - Sistema de Gestión</p>
      </div>
    `
  }
  
  try{
    const info = await transporter.sendMail(mailOptions)
    console.log('✅ Email enviado correctamente a:', email)
    
    // Si es Ethereal (desarrollo), devolver URL de vista previa
    if(etherealCreds){
      const previewUrl = nodemailer.getTestMessageUrl(info)
      return { success: true, preview_url: previewUrl, ethereal_user: etherealCreds.user, ethereal_pass: etherealCreds.pass }
    }
    return { success: true }
  } catch(err){
    console.error('❌ Error al enviar email:', err)
    throw new Error('No se pudo enviar el email: ' + err.message)
  }
}

