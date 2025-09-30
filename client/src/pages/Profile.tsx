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
    <div className="profile-page">
      <h2>Profile</h2>

      <div className="profile-grid">
        <div className="profile-card">
          <div className="avatar-wrap">
            <img className="avatar-xl" src={avatarUrl || 'https://api.dicebear.com/7.x/thumbs/svg?seed=' + (user?.username||'you')} alt="avatar" />
          </div>
          <div className="profile-info">
            <label>Username</label>
            <input value={username} onChange={(e:any)=>setUsername(e.target.value)} />

            <label>Avatar</label>
            <input type="file" accept="image/*" onChange={(e:any)=>setAvatarFile(e.target.files?.[0]||null)} />

            <div className="profile-actions">
              <button className="btn btn-primary" onClick={async()=>{
                let finalAvatar = avatarUrl
                if (avatarFile) {
                  const form = new FormData()
                  form.append('file', avatarFile)
                  const up = await fetch('/api/upload', { method:'POST', credentials:'include', body: form })
                  if (up.ok) { const data = await up.json(); finalAvatar = data.url }
                }
                await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ username, avatarUrl: finalAvatar }) })
                await refreshProfile(); setMsg('Saved!'); setTimeout(()=>setMsg(''), 1500)
              }}>Save profile</button>

              {!user?.googleLinked ? (
                <button className="btn btn-google" onClick={async ()=>{
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
                <div className="google-group">
                  <div className="google-left">
                    <span className="calendar-badge">Google connected</span>
                    {selectedCalendarSummary ? (
                      <span className="calendar-selected">{selectedCalendarSummary}</span>
                    ) : null}
                  </div>
                  <div className="google-actions">
                    <button className="btn btn-secondary" onClick={async ()=>{
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
                    }}>{calendarsLoading ? <span className="spinner small"></span> : 'Choose calendar'}</button>
                    <button className="btn btn-ghost" onClick={async ()=>{ await fetch('/api/google/disconnect', { method:'POST', credentials:'include' }); await refreshProfile(); push({ id: String(Date.now()), type: 'info', title: 'Google', body: 'Disconnected' }) }}>Disconnect</button>
                  </div>
                </div>
              )}

            </div>
            {msg && <div className="muted">{msg}</div>}
          </div>
        </div>

        <div className="profile-card">
          <h3>Account</h3>
          <div className="col">
            <div><strong>Email:</strong> {user?.email}</div>
            <div style={{marginTop:8}}><strong>Member since:</strong> {user ? new Date(user.createdAt || Date.now()).toLocaleDateString() : '-'}</div>
          </div>
        </div>
      </div>

      {showCalendarModal && (
        <div className="discord-modal-overlay" onClick={()=>setShowCalendarModal(false)}>
          <div className="discord-modal" onClick={(e)=>e.stopPropagation()}>
            <div className="discord-modal-header">
              <h3 style={{margin:0}}>Choose Google Calendar</h3>
            </div>
            <div className="event-modal-content">
              {calendarsLoading && (
                <div style={{padding:24, textAlign:'center'}}><span className="spinner" style={{width:28,height:28,border:'3px solid #eee', borderTopColor:'#333', borderRadius:999, display:'inline-block', animation:'spin 1s linear infinite'}}></span></div>
              )}
              {!calendarsLoading && (
                <div className="calendar-list">
                  {calendars.length ? calendars.map((c)=> (
                    <div key={c.id} className="calendar-item">
                      <div>
                        <div className="calendar-title">{c.summary}</div>
                        {c.primary && <div className="muted" style={{fontSize:12}}>Primary calendar</div>}
                      </div>
                      <div>
                        <button className="btn" onClick={async ()=>{
                          const resp = await fetch('/api/google/selectCalendar', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ calendarId: c.id }) })
                          if (resp.ok) { setShowCalendarModal(false); await refreshProfile(); setSelectedCalendarSummary(c.summary); push({ id: String(Date.now()), type: 'success', title: 'Calendar', body: 'Saved: ' + c.summary }) } else { push({ id: String(Date.now()), type: 'error', title: 'Calendar', body: 'Failed to save' }) }
                        }}>Select</button>
                      </div>
                    </div>
                  )) : (
                    <div style={{padding:8}}>No calendars found</div>
                  )}
                </div>
              )}
            </div>
            <div className="discord-modal-footer">
              <button className="btn" onClick={()=>setShowCalendarModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
