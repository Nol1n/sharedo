import { useEffect, useState } from 'react'
import { useAuth } from '../auth'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'

type Event = { id: string; title: string; date: string; description?: string; ideaId?: string; availability?: any[] }
type DetailedEvent = Event & { idea?: { id: string; title: string; description?: string; imageUrl?: string }; availability?: any[]; createdBy?: string }

export default function CalendarPage(){
  const { user, socket } = useAuth()
  const [events, setEvents] = useState<Event[]>([])
  const [selectedEvent, setSelectedEvent] = useState<DetailedEvent|null>(null)

  async function load(){
    const res = await fetch('/api/events', { credentials: 'include' })
    if (res.ok) setEvents(await res.json())
  }
  useEffect(()=>{ load() }, [])

  // Realtime refresh via socket
  useEffect(()=>{
    if (!socket) return
    const refresh = ()=> load()
    socket.on('event:created', refresh)
    socket.on('event:updated', refresh)
    socket.on('event:deleted', refresh)
    socket.on('event:availability', refresh)
    return ()=>{
      socket.off('event:created', refresh)
      socket.off('event:updated', refresh)
      socket.off('event:deleted', refresh)
      socket.off('event:availability', refresh)
    }
  }, [socket])

  // Creation is handled from Moodboard only, so we remove Add button here

  async function openDetails(info:any){
    const id = info.event.id
    const res = await fetch(`/api/events/${id}`, { credentials: 'include' })
    if (res.ok) setSelectedEvent(await res.json())
  }
  async function deleteEvent(){
    if (!selectedEvent) return
    if (!confirm('Delete this event?')) return
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
    await fetch(`/api/events/${selectedEvent.id}/availability`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ status }) })
    await load()
  }

  return (
    <div>
      <div className="row justify"><h2>Calendar</h2></div>
      <FullCalendar
        plugins={[dayGridPlugin]}
        initialView="dayGridMonth"
        events={events.map(e=>({ id: e.id, title: e.title, start: e.date }))}
        eventClick={openDetails}
        height="auto"
      />
      {selectedEvent && (
        <div className="drawer">
          <h3>{selectedEvent.title}</h3>
          <p>Date: {new Date(selectedEvent.date).toLocaleString()}</p>
          {selectedEvent.idea && (
            <div className="row" style={{alignItems:'flex-start'}}>
              {selectedEvent.idea.imageUrl && <img src={selectedEvent.idea.imageUrl} alt="idea" style={{width:120, height:80, objectFit:'cover', borderRadius:8}} />}
              <div>
                <div className="muted">From idea</div>
                <div style={{fontWeight:600}}>{selectedEvent.idea.title}</div>
                {selectedEvent.idea.description && <div className="muted" style={{whiteSpace:'pre-wrap'}}>{selectedEvent.idea.description}</div>}
              </div>
            </div>
          )}
          <div className="row">
            <button onClick={()=>rsvp('yes')}>✔ Yes</button>
            <button onClick={()=>rsvp('maybe')}>? Maybe</button>
            <button onClick={()=>rsvp('no')}>✘ No</button>
          </div>
          {((selectedEvent?.createdBy && user?.id === selectedEvent.createdBy) || (selectedEvent?.idea && user?.id === (selectedEvent.idea as any).createdBy)) && (
            <div className="row" style={{ justifyContent:'flex-end' }}>
              <button className="danger" onClick={deleteEvent}>Delete event</button>
            </div>
          )}
          <h4>Availability</h4>
          <div className="chatWindow" style={{maxHeight:260, overflow:'auto'}}>
            {selectedEvent.availability?.map((a:any)=> {
              const status = a.status==='yes' ? 'oui' : a.status==='no' ? 'non' : 'nsp'
              return (
                <div key={a.id} className="msg">
                  <img src={a.avatarUrl || 'https://api.dicebear.com/7.x/thumbs/svg?seed='+(a.username||'friend')} />
                  <div className="bubble">
                    <div className="meta"><strong>{a.username || a.userId?.slice(0,6)}</strong></div>
                    <div className="text">{status}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
