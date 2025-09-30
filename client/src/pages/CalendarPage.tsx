import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth'
import { useNotifications } from '../notifications'
import PlaceInput from '../components/PlaceInput'
import NominatimAutocomplete from '../components/NominatimAutocomplete'
import MapPreview from '../components/MapPreview'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'

type Event = { id: string; title: string; date: string; description?: string; ideaId?: string; availability?: any[] }
type DetailedEvent = Event & { idea?: { id: string; title: string; description?: string; imageUrl?: string }; availability?: any[]; createdBy?: string }

export default function CalendarPage(){
  const { user, socket } = useAuth()
  const [events, setEvents] = useState<Event[]>([])
  const [selectedEvent, setSelectedEvent] = useState<DetailedEvent|null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [rsvpLoading, setRsvpLoading] = useState<string|null>(null)
  const [specialDays, setSpecialDays] = useState<Record<string, string>>({})
  const [specialVersion, setSpecialVersion] = useState(0)
  const [userMap, setUserMap] = useState<Record<string, { username?: string; avatarUrl?: string }>>({})
  const { push } = useNotifications()
  const [checklistItems, setChecklistItems] = useState<any[]>([])
  const [shoppingItems, setShoppingItems] = useState<any[]>([])
  const [newChecklistText, setNewChecklistText] = useState('')
  const [newShoppingText, setNewShoppingText] = useState('')

  async function load(){
    setIsLoading(true)
    const res = await fetch('/api/events', { credentials: 'include' })
    if (res.ok) setEvents(await res.json())
    setIsLoading(false)
  }
  useEffect(()=>{ load() }, [])

  // load special days
  async function loadSpecialDays(){
    try {
  const res = await fetch('/api/special-days', { credentials: 'include' })
      if (res.ok) {
        const rows = await res.json()
        const map: Record<string,string> = {}
        for (const r of rows) map[r.date] = r.color
        setSpecialDays(map)
        setSpecialVersion(v => v + 1)
      }
    } catch {}
  }
  useEffect(()=>{ loadSpecialDays() }, [])

  // load presence/users for avatar lookups
  async function loadUsersMap(){
    try {
      const res = await fetch('/api/presence', { credentials: 'include' })
      if (!res.ok) return
      const rows = await res.json()
      const m: any = {}
      for (const r of rows) m[r.id] = { username: r.username, avatarUrl: r.avatarUrl }
      setUserMap(m)
    } catch {}
  }
  useEffect(()=>{ loadUsersMap() }, [])

  // Realtime refresh via socket
  useEffect(()=>{
    if (!socket) return
    
    const refresh = async () => {
      await load()
      // Si un événement est sélectionné, recharger ses détails aussi
      if (selectedEvent) {
        const res = await fetch(`/api/events/${selectedEvent.id}`, { credentials: 'include' })
        if (res.ok) {
          const updatedEvent = await res.json()
          setSelectedEvent(updatedEvent)
        }
      }
    }
    
    socket.on('event:created', refresh)
    socket.on('event:updated', refresh)
    socket.on('event:deleted', refresh)
    socket.on('event:availability', refresh)
    const onSpecial = (p: { date: string; color: string|null }) => {
      setSpecialDays(prev => {
        const next = { ...prev }
        if (p.color) next[p.date] = p.color; else delete next[p.date]
        return next
      })
      setSpecialVersion(v => v + 1)
    }
    socket.on('special:changed', onSpecial)
    
    return ()=>{
      socket.off('event:created', refresh)
      socket.off('event:updated', refresh)
      socket.off('event:deleted', refresh)
      socket.off('event:availability', refresh)
      socket.off('special:changed', onSpecial)
    }
  }, [socket, selectedEvent])

  // Live update avatars/usernames in drawer when a user updates profile
  useEffect(() => {
    if (!socket) return
    const onUserUpdated = (u: { id: string; username: string; avatarUrl?: string }) => {
      setSelectedEvent(prev => {
        if (!prev || !prev.availability) return prev
        const availability = prev.availability.map((a:any)=> a.userId===u.id ? { ...a, username: u.username, avatarUrl: u.avatarUrl } : a)
        return { ...prev, availability }
      })
    }
    socket.on('user:updated', onUserUpdated)
    return () => { socket.off('user:updated', onUserUpdated) }
  }, [socket])

  const palette = useMemo(() => [
    '#FFE6E6', // light rose
    '#E6F7FF', // light blue
    '#EAFBE7', // light green
    '#FFF7E6', // light orange
    '#F3E8FF', // light purple
    '#FDF2F8'  // light pink
  ], [])

  function dateStrFromDate(d: Date){
    // toISOString is UTC; use local date parts to avoid off-by-one
    const y = d.getFullYear()
    const m = (d.getMonth()+1).toString().padStart(2,'0')
    const day = d.getDate().toString().padStart(2,'0')
    return `${y}-${m}-${day}`
  }

  async function toggleDayColor(dateStr: string){
    const has = !!specialDays[dateStr]
    if (has) {
      await fetch(`/api/special-days/${dateStr}`, { method: 'DELETE', credentials: 'include' })
    } else {
      const idx = (dateStr.charCodeAt(0) + dateStr.charCodeAt(1) + dateStr.charCodeAt(2)) % palette.length
      const color = palette[idx]
      await fetch(`/api/special-days/${dateStr}`, { method: 'PUT', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ color }) })
    }
  }

  async function openDetails(info:any){
    const id = info.event.id
    const res = await fetch(`/api/events/${id}`, { credentials: 'include' })
    if (res.ok) setSelectedEvent(await res.json())
  }

  // load checklist and shopping for selected event when it changes
  useEffect(()=>{
    if (!selectedEvent) return
    setChecklistItems(selectedEvent.checklist || [])
    setShoppingItems(selectedEvent.shopping || [])
  }, [selectedEvent])

  async function addChecklist(){
    if (!selectedEvent || !newChecklistText.trim()) return
    const res = await fetch(`/api/events/${selectedEvent.id}/checklist`, { method: 'POST', credentials: 'include', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ text: newChecklistText }) })
    if (res.ok) {
      const it = await res.json(); setChecklistItems(prev => [it, ...prev]); setNewChecklistText(''); push({ id: String(Date.now()), type: 'success', title: 'Checklist', body: 'Added' })
    } else { push({ id: String(Date.now()), type: 'error', title: 'Checklist', body: 'Failed to add' }) }
  }

  async function toggleChecklist(item:any){
    const res = await fetch(`/api/events/${selectedEvent.id}/checklist/${item.id}`, { method: 'PUT', credentials: 'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ done: !item.done }) })
    if (res.ok) { const updated = await res.json(); setChecklistItems(prev => prev.map(p => p.id===updated.id ? updated : p)) } else { push({ id: String(Date.now()), type: 'error', title: 'Checklist', body: 'Failed' }) }
  }

  async function deleteChecklist(item:any){
    const res = await fetch(`/api/events/${selectedEvent.id}/checklist/${item.id}`, { method: 'DELETE', credentials: 'include' })
    if (res.ok) setChecklistItems(prev => prev.filter(p => p.id !== item.id))
  }

  async function addShopping(){
    if (!selectedEvent || !newShoppingText.trim()) return
    const res = await fetch(`/api/events/${selectedEvent.id}/shopping`, { method: 'POST', credentials: 'include', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ item: newShoppingText, qty: '1' }) })
    if (res.ok) { const it = await res.json(); setShoppingItems(prev => [it, ...prev]); setNewShoppingText(''); push({ id: String(Date.now()), type: 'success', title: 'Shopping', body: 'Added' }) } else { push({ id: String(Date.now()), type: 'error', title: 'Shopping', body: 'Failed to add' }) }
  }

  async function toggleShopping(item:any){
    const res = await fetch(`/api/events/${selectedEvent.id}/shopping/${item.id}`, { method: 'PUT', credentials: 'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ bought: !item.bought }) })
    if (res.ok) { const u = await res.json(); setShoppingItems(prev => prev.map(p => p.id===u.id ? u : p)) }
  }

  async function deleteShopping(item:any){
    const res = await fetch(`/api/events/${selectedEvent.id}/shopping/${item.id}`, { method: 'DELETE', credentials: 'include' })
    if (res.ok) setShoppingItems(prev => prev.filter(p => p.id !== item.id))
  }

  async function deleteEvent(){
    if (!selectedEvent) return
    if (!confirm('Are you sure you want to delete this event? This action cannot be undone.')) return
    
    const id = selectedEvent.id
    const res = await fetch(`/api/events/${id}`, { method:'DELETE', credentials:'include' })
    if (!res.ok) {
      try {
        const data = await res.json()
        push({ id: String(Date.now()) , type: 'error', title: 'Delete failed', body: (data?.error || res.statusText) })
      } catch {
        push({ id: String(Date.now()) , type: 'error', title: 'Delete failed', body: res.statusText })
      }
      return
    }
    // Optimistic update
    setEvents(prev => prev.filter(e => e.id !== id))
    setSelectedEvent(null)
  }

  async function rsvp(status:'yes'|'no'|'maybe'){
    if (!selectedEvent) return
    
    setRsvpLoading(status)
    
    try {
      const res = await fetch(`/api/events/${selectedEvent.id}/availability`, { 
        method:'POST', 
        headers:{'Content-Type':'application/json'}, 
        credentials:'include', 
        body: JSON.stringify({ status }) 
      })
      
      if (res.ok) {
        // Recharger les détails de l'événement sélectionné
        const updatedEventRes = await fetch(`/api/events/${selectedEvent.id}`, { credentials: 'include' })
        if (updatedEventRes.ok) {
          const updatedEvent = await updatedEventRes.json()
          setSelectedEvent(updatedEvent)
        }
        
        // Recharger la liste des événements
        await load()
      } else {
      console.error('RSVP failed:', res.statusText)
      push({ id: String(Date.now()), type: 'error', title: 'RSVP failed', body: 'Please try again.' })
    }
      } catch (error) {
  console.error('RSVP error:', error)
  push({ id: String(Date.now()), type: 'error', title: 'RSVP error', body: 'Please try again.' })
    } finally {
      setRsvpLoading(null)
    }
  }

  const getStatusCounts = () => {
    if (!selectedEvent?.availability) return { yes: 0, no: 0, maybe: 0 }
    return selectedEvent.availability.reduce((acc, a) => {
      acc[a.status] = (acc[a.status] || 0) + 1
      return acc
    }, { yes: 0, no: 0, maybe: 0 })
  }

  const getUserStatus = () => {
    if (!selectedEvent?.availability || !user) return null
    return selectedEvent.availability.find(a => a.userId === user.id)?.status
  }

  return (
    <div className="calendar-page">
      <div className="calendar-header">
        <div className="calendar-title">
          <h1>📅 Calendar</h1>
          <p>Manage your events and track availability</p>
        </div>
        <div className="calendar-stats">
          <div className="stat-card">
            <div className="stat-number">{events.length}</div>
            <div className="stat-label">Total Events</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{events.filter(e => new Date(e.date) >= new Date()).length}</div>
            <div className="stat-label">Upcoming</div>
          </div>
        </div>
      </div>

      <div className="calendar-container">
        {isLoading ? (
          <div className="calendar-loading">
            <div className="loading-spinner"></div>
            <p>Loading events...</p>
          </div>
        ) : (
          <div className="modern-calendar">
            {(() => { const FC: any = FullCalendar as any; return (
            <FC
              key={`cal-${specialVersion}`}
              plugins={[dayGridPlugin]}
              initialView="dayGridMonth"
              dayCellDidMount={(args: any) => {
                const dateStr = dateStrFromDate(args.date)
                const color = specialDays[dateStr]
                if (color) {
                  args.el.style.background = color
                  args.el.style.borderRadius = '8px'
                }
                // Avoid duplicate trigger
                if (args.el.querySelector('.day-color-trigger')) return
                if (getComputedStyle(args.el).position === 'static') args.el.style.position = 'relative'
                // Create trigger button at bottom
                const trigger = document.createElement('button')
                trigger.className = 'day-color-trigger'
                trigger.title = 'Choisir une couleur'
                trigger.textContent = '🎨'
                Object.assign(trigger.style, {
                  position: 'absolute', bottom: '6px', left: '50%', transform: 'translateX(-50%)',
                  border: '1px solid #d8d5cc', background: '#fff', borderRadius: '12px', padding: '2px 6px',
                  fontSize: '12px', opacity: '0', cursor: 'pointer', transition: 'opacity 0.15s'
                } as any)

                // Palette popover
                const pop = document.createElement('div')
                pop.className = 'day-color-popover'
                Object.assign(pop.style, {
                  position: 'absolute', bottom: '28px', left: '50%', transform: 'translateX(-50%)',
                  display: 'none', gap: '6px', padding: '6px', background: '#fff', border: '1px solid #d8d5cc',
                  borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', zIndex: 20
                } as any)

                const addSwatch = (swatchColor: string|null, label: string) => {
                  const s = document.createElement('button')
                  s.title = label
                  Object.assign(s.style, {
                    width: '18px', height: '18px', borderRadius: '4px', border: '1px solid #cfcabc',
                    cursor: 'pointer', padding: '0'
                  } as any)
                  if (swatchColor) {
                    s.style.background = swatchColor
                  } else {
                    s.style.background = 'transparent'
                    s.style.border = '1px dashed #cfcabc'
                    s.textContent = 'Ø'
                    s.style.fontSize = '12px'
                    s.style.lineHeight = '16px'
                    s.style.color = '#888'
                  }
                  s.onclick = async (e) => {
                    e.stopPropagation()
                    if (swatchColor) {
                      // Optimistic update
                      setSpecialDays(prev => ({ ...prev, [dateStr]: swatchColor }))
                      setSpecialVersion(v => v + 1)
                      await fetch(`/api/special-days/${dateStr}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials:'include', body: JSON.stringify({ color: swatchColor }) })
                    } else {
                      setSpecialDays(prev => { const n = { ...prev }; delete n[dateStr]; return n })
                      setSpecialVersion(v => v + 1)
                      await fetch(`/api/special-days/${dateStr}`, { method: 'DELETE', credentials:'include' })
                    }
                    pop.style.display = 'none'
                  }
                  pop.appendChild(s)
                }

                const paletteColors = palette
                for (const c of paletteColors) addSwatch(c, 'Appliquer la couleur')
                addSwatch(null, 'Sans couleur')

                let isOpen = false
                trigger.onclick = (e) => {
                  e.stopPropagation()
                  const nextOpen = pop.style.display === 'none'
                  pop.style.display = nextOpen ? 'flex' : 'none'
                  isOpen = nextOpen
                  if (isOpen) trigger.style.opacity = '1'
                }

                const closeOnOutside = (ev: any) => {
                  if (!args.el.contains(ev.target)) {
                    pop.style.display = 'none'
                    isOpen = false
                    document.removeEventListener('click', closeOnOutside)
                  }
                }
                trigger.addEventListener('click', ()=>{
                  document.addEventListener('click', closeOnOutside)
                })

                // Show trigger only on day-cell hover (unless popover is open)
                args.el.addEventListener('mouseenter', ()=>{ trigger.style.opacity = '1' })
                args.el.addEventListener('mouseleave', ()=>{
                  if (!isOpen) {
                    trigger.style.opacity = '0'
                    pop.style.display = 'none'
                  }
                })

                args.el.appendChild(trigger)
                args.el.appendChild(pop)
                // Render small avatar dots for events on this date
                // Avoid duplication
                if (args.el.querySelector('.day-avatars')) return
                const wrapper = document.createElement('div')
                wrapper.className = 'day-avatars'
                Object.assign(wrapper.style, { position: 'absolute', top: '6px', right: '6px', display: 'flex', gap: '4px', zIndex: 10 } as any)
                // find events on this date
                const dayEvents = events.filter(ev => ev.date && ev.date.startsWith(dateStr))
                const avatars: string[] = []
                for (const ev of dayEvents) {
                  if (ev.availability && Array.isArray(ev.availability)) {
                    for (const a of ev.availability) {
                      const u = userMap[a.userId]
                      if (u && u.avatarUrl) avatars.push(u.avatarUrl)
                      if (avatars.length >= 6) break
                    }
                  }
                  if (avatars.length >= 6) break
                }
                // Compute tooltip text via usernames map
                const names: string[] = []
                for (const ev of dayEvents) {
                  if (ev.availability && Array.isArray(ev.availability)) {
                    for (const a of ev.availability) {
                      const u = userMap[a.userId]
                      if (u && u.username) names.push(u.username)
                      if (names.length >= 20) break
                    }
                  }
                  if (names.length >= 20) break
                }
                // show up to 5 avatars, last slot becomes +N if overflow
                const max = 5
                const toShow = avatars.slice(0, max)
                const overflow = Math.max(0, avatars.length - max)
                for (let i = 0; i < toShow.length; i++) {
                  const img = document.createElement('img')
                  img.src = toShow[i]
                  Object.assign(img.style, { width: '18px', height: '18px', borderRadius: '50%', border: '2px solid white', boxShadow: '0 1px 2px rgba(0,0,0,0.12)' } as any)
                  wrapper.appendChild(img)
                }
                if (overflow > 0) {
                  const badge = document.createElement('div')
                  badge.textContent = `+${overflow}`
                  Object.assign(badge.style, { width: '18px', height: '18px', borderRadius: '50%', background: 'var(--card)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', border: '2px solid white' } as any)
                  wrapper.appendChild(badge)
                }
                if (names.length) wrapper.title = Array.from(new Set(names)).slice(0,10).join(', ')
                if (wrapper.childElementCount) args.el.appendChild(wrapper)
              }}
              events={events.map(e=>({ 
                id: e.id, 
                title: e.title, 
                start: e.date,
                backgroundColor: '#d4af37',
                borderColor: '#c19b2e',
                textColor: '#fff'
              }))}
              eventClick={openDetails}
              height="auto"
              headerToolbar={{
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,dayGridWeek'
              }}
              dayMaxEvents={3}
              moreLinkClick="popover"
              eventDisplay="block"
              eventTextColor="#fff"
              eventBorderColor="transparent"
              eventBackgroundColor="#6c63ff"
              dayHeaderFormat={{ weekday: 'short' }}
              buttonText={{
                today: 'Today',
                month: 'Month',
                week: 'Week'
              }}
            />)})()}
          </div>
        )}
      </div>

      {selectedEvent && (
        <div className="event-modal-overlay" onClick={() => setSelectedEvent(null)}>
          <div className="event-modal" onClick={(e) => e.stopPropagation()}>
            <div className="event-modal-header">
              <div className="event-title-section">
                <h2>{selectedEvent.title}</h2>
                <div className="event-date">
                  <span className="date-icon">📅</span>
                  {new Date(selectedEvent.date).toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </div>
              </div>
              <button className="close-modal-btn" onClick={() => setSelectedEvent(null)}>
                ✕
              </button>
            </div>

            <div className="event-modal-content">
              {selectedEvent.idea && (
                <div className="event-idea-section">
                  <h3>📋 Related Idea</h3>
                  <div className="idea-card">
                    {selectedEvent.idea.imageUrl && (
                      <img 
                        src={selectedEvent.idea.imageUrl} 
                        alt="idea" 
                        className="idea-image"
                      />
                    )}
                    <div className="idea-content">
                      <h4>{selectedEvent.idea.title}</h4>
                      {selectedEvent.idea.description && (
                        <p className="idea-description">{selectedEvent.idea.description}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="rsvp-section">
                <h3>🎯 RSVP</h3>
                <div className="rsvp-buttons">
                  <button 
                    className={`rsvp-btn rsvp-yes ${getUserStatus() === 'yes' ? 'active' : ''}`}
                    onClick={() => rsvp('yes')}
                    disabled={rsvpLoading !== null}
                  >
                    <span className="rsvp-icon">
                      {rsvpLoading === 'yes' ? '⏳' : '✅'}
                    </span>
                    <span className="rsvp-text">
                      {rsvpLoading === 'yes' ? 'Updating...' : 'Yes'}
                    </span>
                    <span className="rsvp-count">{getStatusCounts().yes}</span>
                  </button>
                  <button 
                    className={`rsvp-btn rsvp-maybe ${getUserStatus() === 'maybe' ? 'active' : ''}`}
                    onClick={() => rsvp('maybe')}
                    disabled={rsvpLoading !== null}
                  >
                    <span className="rsvp-icon">
                      {rsvpLoading === 'maybe' ? '⏳' : '❓'}
                    </span>
                    <span className="rsvp-text">
                      {rsvpLoading === 'maybe' ? 'Updating...' : 'Maybe'}
                    </span>
                    <span className="rsvp-count">{getStatusCounts().maybe}</span>
                  </button>
                  <button 
                    className={`rsvp-btn rsvp-no ${getUserStatus() === 'no' ? 'active' : ''}`}
                    onClick={() => rsvp('no')}
                    disabled={rsvpLoading !== null}
                  >
                    <span className="rsvp-icon">
                      {rsvpLoading === 'no' ? '⏳' : '❌'}
                    </span>
                    <span className="rsvp-text">
                      {rsvpLoading === 'no' ? 'Updating...' : 'No'}
                    </span>
                    <span className="rsvp-count">{getStatusCounts().no}</span>
                  </button>
                </div>
              </div>

              <div className="availability-section">
                <h3>👥 Availability ({selectedEvent.availability?.length || 0})</h3>
                <div className="availability-list">
                  {selectedEvent.availability?.length ? (
                    selectedEvent.availability.map((a: any) => {
                      const statusEmoji = a.status === 'yes' ? '✅' : a.status === 'no' ? '❌' : '❓'
                      const statusText = a.status === 'yes' ? 'Going' : a.status === 'no' ? 'Not going' : 'Maybe'
                      return (
                        <div key={a.id} className="availability-item">
                          <img 
                            src={a.avatarUrl || `https://api.dicebear.com/7.x/thumbs/svg?seed=${a.username || 'friend'}`} 
                            alt={a.username}
                            className="availability-avatar"
                          />
                          <div className="availability-info">
                            <div className="availability-name">{a.username || a.userId?.slice(0, 6)}</div>
                            <div className={`availability-status status-${a.status}`}>
                              <span className="status-emoji">{statusEmoji}</span>
                              <span className="status-text">{statusText}</span>
                            </div>
                          </div>
                        </div>
                      )
                    })
                  ) : (
                    <div className="no-availability">
                      <span className="no-availability-icon">👥</span>
                      <p>No responses yet</p>
                    </div>
                  )}
                </div>
              </div>
            
            <div style={{padding: '12px 24px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center'}}>
                  {selectedEvent?.google_event_id ? (
                <>
                  <span style={{display:'inline-block', padding:'4px 8px', background:'#e6f0ff', borderRadius:6, color:'#074'}} title="This event exists in your Google Calendar">In Google</span>
                  {selectedEvent?.google_event_synced_at ? (
                    <div style={{fontSize:12, color:'#666', marginLeft:8}}>Synced: {new Date(selectedEvent.google_event_synced_at).toLocaleString()}</div>
                  ) : null}
                  <button style={{marginLeft:8}} onClick={async ()=>{
                    const res = await fetch(`/api/events/${selectedEvent.id}/googleUpdate`, { method: 'POST', credentials: 'include' })
                    if (res.ok) { push({ id: String(Date.now()), type: 'success', title: 'Google', body: 'Event updated on your Google Calendar' }) } else { const d = await res.json().catch(()=>null); push({ id: String(Date.now()), type: 'error', title: 'Google', body: 'Failed: ' + (d?.error || 'unknown') }) }
                  }}>Update on Google</button>
                  <button style={{marginLeft:8}} onClick={async ()=>{
                    if (!confirm('Remove this event from your Google Calendar?')) return
                    const res = await fetch(`/api/events/${selectedEvent.id}/googleRemove`, { method: 'POST', credentials: 'include' })
                    if (res.ok) { push({ id: String(Date.now()), type: 'success', title: 'Google', body: 'Event removed from your Google Calendar' }); await fetch('/api/events').then(()=>window.location.reload()) } else { const d = await res.json().catch(()=>null); push({ id: String(Date.now()), type: 'error', title: 'Google', body: 'Failed: ' + (d?.error || 'unknown') }) }
                  }}>Remove from Google</button>
                </>
              ) : (
                <button onClick={async ()=>{
                  if (!selectedEvent) return
                  const res = await fetch(`/api/events/${selectedEvent.id}/googleAdd`, { method: 'POST', credentials: 'include' })
                  if (res.ok) { push({ id: String(Date.now()), type: 'success', title: 'Google', body: 'Event added to your Google Calendar' }) } else { const d = await res.json().catch(()=>null); push({ id: String(Date.now()), type: 'error', title: 'Google', body: 'Failed: ' + (d?.error || 'unknown') }) }
                }}>Add to Google Calendar</button>
              )}
            </div>

              <div style={{padding: '12px 24px', borderTop: '1px solid var(--border)'}}>
              <h4>📍 Location</h4>
              <div>
                {/* Place input: use Google Places Autocomplete if available, otherwise use our Nominatim autocomplete (single controlled input) */}
                {(
                  (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY &&
                  (typeof window !== 'undefined' && (window as any).google?.maps?.places)
                ) ? (
                  <PlaceInput value={selectedEvent.location||''} onChange={(v:any)=> setSelectedEvent({...selectedEvent, location: v})} onSelect={(place:any)=>{
                    if (place && place.geometry && place.geometry.location) {
                      setSelectedEvent({...selectedEvent, location: place.formatted_address || place.name, place_lat: place.geometry.location.lat(), place_lng: place.geometry.location.lng()})
                    }
                  }} />
                ) : (
                  <div style={{marginTop:8}}>
                    <NominatimAutocomplete value={selectedEvent.location||''} onChange={(v:any)=> setSelectedEvent({...selectedEvent, location: v})} onSelect={(r:any)=> setSelectedEvent({...selectedEvent, location: r.display_name, place_lat: Number(r.lat), place_lng: Number(r.lon)})} />
                  </div>
                )}

                <div style={{marginTop:8, display:'flex', gap:8, alignItems:'center'}}>
                  <div style={{flex:1}}>
                    <button onClick={async ()=>{
                      if (!selectedEvent) return
                      const pushId = String(Date.now())
                      const q = encodeURIComponent(selectedEvent.location || '')
                      // Preserve existing coords if present — don't overwrite them on failed geocode
                      let lat = selectedEvent.place_lat
                      let lon = selectedEvent.place_lng

                      // Only attempt a fresh geocode when we don't already have coordinates
                      const needsGeocode = (lat === null || lat === undefined) || (lon === null || lon === undefined)
                      if (needsGeocode && q) {
                        // Perform geocode attempt (proxy -> public -> dev stub when no coords existed)
                        try {
                          let geoRes = await fetch((import.meta as any).env.DEV ? `http://localhost:4000/api/geocode?q=${q}` : `/api/geocode?q=${q}`)
                          if (!geoRes.ok) {
                            if (!(import.meta as any).env?.VITE_DISABLE_CLIENT_GEOCODE_FALLBACK) {
                              geoRes = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&q=${q}&limit=1&addressdetails=1`)
                            }
                          }
                          if (geoRes && geoRes.ok) {
                            const arr = await geoRes.json()
                            if (arr && arr.length) {
                              lat = Number(arr[0].lat)
                              lon = Number(arr[0].lon)
                            }
                          }
                        } catch (e:any) {
                          // Only apply dev-stub coords if we had no coords before — otherwise keep existing
                          const devStubEnabled = (import.meta as any).env?.VITE_ENABLE_DEV_GEOCODE_STUB || (import.meta as any).env?.DEV
                          if (devStubEnabled && (lat === null || lat === undefined) && (lon === null || lon === undefined)) {
                            lat = 48.8566; lon = 2.3522
                          } else if (!(lat !== null && lat !== undefined && lon !== null && lon !== undefined)) {
                            // Geocode failed silently — preserve existing coords if any
                          }
                        }
                      }

                      // Persist the coords immediately (only include values that are defined)
                      const payload: any = { location: selectedEvent.location }
                      if (lat !== undefined && lat !== null) payload.place_lat = lat
                      if (lon !== undefined && lon !== null) payload.place_lng = lon
                      const res = await fetch(`/api/events/${selectedEvent.id}`, { method:'PUT', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) })
                      if (res.ok) {
                        push({ id: String(Date.now()), type: 'success', title: 'Location', body: 'Geocoded and saved' })
                        const updated = await res.json(); setSelectedEvent(updated)
                      } else {
                        push({ id: String(Date.now()), type: 'error', title: 'Location', body: 'Failed to save' })
                      }
                    }}>Geocode & Save</button>
                  </div>
                  <div style={{fontSize:13, color:'#444'}}>
                    {selectedEvent?.place_lat && selectedEvent?.place_lng ? (
                      <div>Lat: {selectedEvent.place_lat} · Lng: {selectedEvent.place_lng}</div>
                    ) : (
                      <div className="muted">No coords yet</div>
                    )}
                  </div>
                </div>
              </div>
                <MapPreview lat={selectedEvent?.place_lat} lng={selectedEvent?.place_lng} title={selectedEvent?.title} location={selectedEvent?.location} onMapClick={(lat:number, lng:number)=> setSelectedEvent({...selectedEvent, place_lat: lat, place_lng: lng})} />
              <h4 style={{marginTop:12}}>🧾 Checklist</h4>
              <div style={{display:'flex', gap:8, marginBottom:8}}>
                <input placeholder="New checklist item" value={newChecklistText} onChange={(e:any)=>setNewChecklistText(e.target.value)} />
                <button onClick={addChecklist}>Add</button>
              </div>
              <div>
                {checklistItems.map(ci => (
                  <div key={ci.id} style={{display:'flex', alignItems:'center', gap:8, padding:'6px 0'}}>
                    <input type="checkbox" checked={!!ci.done} onChange={()=>toggleChecklist(ci)} />
                    <div style={{flex:1, textDecoration: ci.done ? 'line-through' : 'none'}}>{ci.text}</div>
                    <button onClick={()=>deleteChecklist(ci)}>Delete</button>
                  </div>
                ))}
              </div>

              <h4 style={{marginTop:12}}>🛒 Shopping list</h4>
              <div style={{display:'flex', gap:8, marginBottom:8}}>
                <input placeholder="New item" value={newShoppingText} onChange={(e:any)=>setNewShoppingText(e.target.value)} />
                <button onClick={addShopping}>Add</button>
              </div>
              <div>
                {shoppingItems.map(si => (
                  <div key={si.id} style={{display:'flex', alignItems:'center', gap:8, padding:'6px 0'}}>
                    <input type="checkbox" checked={!!si.bought} onChange={()=>toggleShopping(si)} />
                    <div style={{flex:1, textDecoration: si.bought ? 'line-through' : 'none'}}>{si.item} <span className="muted">x{si.qty}</span></div>
                    <button onClick={()=>deleteShopping(si)}>Delete</button>
                  </div>
                ))}
              </div>
            </div>

            </div>

            <div className="event-modal-footer">
              {((selectedEvent?.createdBy && user?.id === selectedEvent.createdBy) || 
                (selectedEvent?.idea && user?.id === (selectedEvent.idea as any).createdBy)) && (
                <button className="delete-event-btn" onClick={deleteEvent}>
                  <span className="delete-icon">🗑️</span>
                  Delete Event
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
