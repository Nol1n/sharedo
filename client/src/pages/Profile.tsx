import { useEffect, useState } from 'react'
import { useAuth } from '../auth'
import { useNotifications } from '../notifications'

export default function Profile() {
  const { user, refreshProfile } = useAuth()
  const [calendars, setCalendars] = useState<Array<{id:string,summary:string,primary?:boolean}>>([])
  const [showCalendarModal, setShowCalendarModal] = useState(false)
  const [calendarsLoading, setCalendarsLoading] = useState(false)
  const [username, setUsername] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [avatarFile, setAvatarFile] = useState<File|null>(null)
  const [msg, setMsg] = useState('')
  const { push } = useNotifications()
  const [selectedCalendarSummary, setSelectedCalendarSummary] = useState<string | null>(null)
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
          <div style={{marginTop:12}}>
            {!user?.googleLinked ? (
              <button style={{background:'#4285F4', color:'#fff', padding:'8px 12px', borderRadius:8}} onClick={async ()=>{
                // initiate google auth
                const res = await fetch('/api/google/auth', { credentials: 'include' })
                if (!res.ok) { push({ id: String(Date.now()), type: 'error', title: 'Google', body: 'Auth not available on server' }); return }
                const data = await res.json()
                const w = window.open(data.url, 'google-auth', 'width=600,height=700')
                const checker = setInterval(async ()=>{
                  if (w && w.closed) {
                    clearInterval(checker)
                    await refreshProfile()
                  }
                }, 1000)
              }}>Connect Google Calendar</button>
            ) : (
              <>
                <div style={{display:'flex', alignItems:'center', gap:8}}>
                  <span style={{display:'inline-block', padding:'6px 10px', background:'#e6ffe6', borderRadius:8, color:'#086006', fontWeight:600}}>Google connected</span>
                  <button style={{background:'#fff', border:'1px solid #e6e6e6', padding:'8px 10px', borderRadius:8}} onClick={async ()=>{ await fetch('/api/google/disconnect', { method:'POST', credentials:'include' }); await refreshProfile(); push({ id: String(Date.now()), type: 'info', title: 'Google', body: 'Disconnected' }) }}>Disconnect</button>
                  {selectedCalendarSummary ? <div style={{fontSize:13,color:'#555', marginLeft:6}}>Selected: <strong>{selectedCalendarSummary}</strong></div> : null}
                </div>
                <button style={{marginLeft:8}} onClick={async ()=>{
                  // open modal and load calendars
                  setShowCalendarModal(true)
                  setCalendarsLoading(true)
                  try {
                    const res = await fetch('/api/google/calendars', { credentials: 'include' })
                    if (!res.ok) throw new Error('Failed to list')
                    const data = await res.json()
                    setCalendars(data.items || [])
                  } catch (err) {
                    push({ id: String(Date.now()), type: 'error', title: 'Google', body: 'Failed to load calendars' })
                    setShowCalendarModal(false)
                  } finally { setCalendarsLoading(false) }
                }}>
                  {calendarsLoading ? <span style={{display:'inline-flex', alignItems:'center', gap:8}}><span className="spinner" style={{width:14,height:14,border:'2px solid #ccc', borderTopColor:'#333', borderRadius:999, display:'inline-block', animation:'spin 1s linear infinite'}}></span> Loading...</span> : 'Choose Calendar'}
                </button>
              </>
            )}
          </div>
          {msg && <span className="muted">{msg}</span>}
        </div>
      </div>
      {showCalendarModal && (
        <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:2000}} onClick={()=>setShowCalendarModal(false)}>
          <div style={{width:480, maxWidth:'90%', background:'#fff', borderRadius:8, padding:16, boxShadow:'0 8px 24px rgba(0,0,0,0.2)'}} onClick={(e)=>e.stopPropagation()}>
            <h3 style={{marginTop:0}}>Choose Google Calendar</h3>
            <div style={{maxHeight:320, overflow:'auto'}}>
              {calendarsLoading && (
                <div style={{padding:24, textAlign:'center'}}><span className="spinner" style={{width:28,height:28,border:'3px solid #eee', borderTopColor:'#333', borderRadius:999, display:'inline-block', animation:'spin 1s linear infinite'}}></span></div>
              )}
              {!calendarsLoading && (
                <>
                  {calendars.length ? calendars.map((c)=> (
                    <div key={c.id} style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 4px', borderBottom:'1px solid #eee'}}>
                      <div>
                        <div style={{fontWeight:600}}>{c.summary}</div>
                        {c.primary && <div style={{fontSize:12,color:'#666'}}>Primary calendar</div>}
                      </div>
                      <div>
                        <button onClick={async ()=>{
                          const resp = await fetch('/api/google/selectCalendar', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ calendarId: c.id }) })
                          if (resp.ok) { setShowCalendarModal(false); await refreshProfile(); setSelectedCalendarSummary(c.summary); push({ id: String(Date.now()), type: 'success', title: 'Calendar', body: 'Saved: ' + c.summary }) } else { push({ id: String(Date.now()), type: 'error', title: 'Calendar', body: 'Failed to save' }) }
                        }}>Select</button>
                      </div>
                    </div>
                  )) : (
                    <div style={{padding:8}}>No calendars found</div>
                  )}
                </>
              )}
            </div>
            <div style={{textAlign:'right', marginTop:12}}>
              <button onClick={()=>setShowCalendarModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
