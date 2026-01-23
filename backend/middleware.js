import { q } from './db.js'

export async function requireAuth(req,res,next){
  if(!req.session?.user) return res.status(401).json({ error:'No autenticado' })
  try{
    const u = await q.get(`SELECT active FROM users WHERE id=?`, [req.session.user.id])
    if(!u || u.active===0){
      req.session.destroy(()=>{})
      return res.status(401).json({ error:'Cuenta desactivada' })
    }
    return next()
  }catch(err){
    return res.status(500).json({ error:'Error de autenticación' })
  }
}
export function requireRole(role){
  return (req,res,next)=>{
    if(req.session?.user?.role===role) return next()
    return res.status(403).json({ error:'Acceso denegado' })
  }
}
