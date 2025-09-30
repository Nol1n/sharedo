import React, { useEffect, useState } from 'react'
import { useAuth } from '../auth'
import LeafletMap from '../components/LeafletMap'

export default function MapPage(){
  const { user } = useAuth()
  const [events, setEvents] = useState<any[]>([])

  useEffect(()=>{ fetch('/api/events', { credentials: 'include' }).then(r=>r.ok? r.json() : []).then(setEvents).catch(()=>{}) }, [])
  useEffect(()=>{
    (async ()=>{
      try {
        const r = await fetch('/api/events', { credentials: 'include' })
        if (r.ok) { const j = await r.json(); setEvents(j); return }
        // fallback to public dev endpoint if unauthorized
        if (r.status === 401 || r.status === 403 || !r.ok) {
          if ((import.meta as any).env?.DEV) {
            const r2 = await fetch('/api/events/public')
            if (r2.ok) { const j2 = await r2.json(); setEvents(j2); return }
          }
        }
      } catch (e) {
        // ignore
      }
    })()
  }, [])

  // subscribe to realtime socket updates so the map refreshes when events change
  useEffect(() => {
    if (!user || !user.socket) return
    const s = (user as any).socket
    const reload = async () => {
      try {
        const r = await fetch('/api/events', { credentials: 'include' })
        if (r.ok) { const j = await r.json(); setEvents(j); return }
        if ((import.meta as any).env?.DEV) {
          const r2 = await fetch('/api/events/public')
          if (r2.ok) { const j2 = await r2.json(); setEvents(j2); return }
        }
      } catch (e) {}
    }
    s.on('event:created', reload)
    s.on('event:updated', reload)
    return () => { s.off('event:created', reload); s.off('event:updated', reload) }
  }, [user])

  return (
    <div style={{padding:20}}>
      <h2>Map</h2>
      <p>All events with a location are shown here. Add an address in the event modal.</p>
      <LeafletMap events={events} />
    </div>
  )
}
