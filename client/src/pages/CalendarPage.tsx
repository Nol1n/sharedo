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
  const [isLoading, setIsLoading] = useState(false)
  const [rsvpLoading, setRsvpLoading] = useState<string|null>(null)

  async function load(){
    setIsLoading(true)
    const res = await fetch('/api/events', { credentials: 'include' })
    if (res.ok) setEvents(await res.json())
    setIsLoading(false)
  }
  useEffect(()=>{ load() }, [])

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
    
    return ()=>{
      socket.off('event:created', refresh)
      socket.off('event:updated', refresh)
      socket.off('event:deleted', refresh)
      socket.off('event:availability', refresh)
    }
  }, [socket, selectedEvent])

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
            <FullCalendar
              plugins={[dayGridPlugin]}
              initialView="dayGridMonth"
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
            />
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
