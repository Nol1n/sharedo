import { useEffect, useState } from 'react'
import { useAuth } from '../auth'

export default function Profile() {
  const { user, refreshProfile } = useAuth()
  const [username, setUsername] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [avatarFile, setAvatarFile] = useState<File|null>(null)
  const [msg, setMsg] = useState('')
  useEffect(()=>{ if(user){ setUsername(user.username); setAvatarUrl(user.avatarUrl||'') } }, [user])
  return (
    <div>
      <h2>Profile</h2>
      <div className="row">
        <img className="avatar-xl" src={avatarUrl || 'https://api.dicebear.com/7.x/thumbs/svg?seed=' + (user?.username||'you')} />
        <div className="col">
          <label>Username</label>
          <input value={username} onChange={(e:any)=>setUsername(e.target.value)} />
          <label>Avatar</label>
          <input type="file" accept="image/*" onChange={(e:any)=>setAvatarFile(e.target.files?.[0]||null)} />
          <button onClick={async()=>{
            let finalAvatar = avatarUrl
            if (avatarFile) {
              const form = new FormData()
              form.append('file', avatarFile)
              const up = await fetch('/api/upload', { method:'POST', credentials:'include', body: form })
              if (up.ok) { const data = await up.json(); finalAvatar = data.url }
            }
            await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ username, avatarUrl: finalAvatar }) })
            await refreshProfile(); setMsg('Saved!'); setTimeout(()=>setMsg(''), 1500)
          }}>Save</button>
          {msg && <span className="muted">{msg}</span>}
        </div>
      </div>
    </div>
  )
}
