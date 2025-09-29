import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth'
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

  async function deleteEvent(){
    if (!selectedEvent) return
    if (!confirm('Are you sure you want to delete this event? This action cannot be undone.')) return
    
    const id = selectedEvent.id
    const res = await fetch(`/api/events/${id}`, { method:'DELETE', credentials:'include' })
    if (!res.ok) {
      try {
        const data = await res.json()
        alert('Delete failed: ' + (data?.error || res.statusText))
      } catch {
        alert('Delete failed: ' + res.statusText)
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
        alert('Failed to update RSVP. Please try again.')
      }
    } catch (error) {
      console.error('RSVP error:', error)
      alert('An error occurred. Please try again.')
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
