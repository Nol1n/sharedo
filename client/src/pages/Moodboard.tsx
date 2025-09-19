import React, { useEffect, useState } from 'react'
import { useAuth } from '../auth'

type Idea = { id: string; title: string; description?: string; imageUrl?: string; createdBy: string; createdAt: number, votes?: { up: number; down: number }, myVote?: 'up' | 'down' | null }

export default function Moodboard() {
  const { user } = useAuth()
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [title, setTitle] = useState('')
  // Removed image URL text input; we only support file uploads now
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File|null>(null)
  const [show, setShow] = useState(false)
  // Scheduling modal state
  const [scheduleIdea, setScheduleIdea] = useState<Idea | null>(null)
  const [scheduleDate, setScheduleDate] = useState('') // YYYY-MM-DD
  const [scheduleTime, setScheduleTime] = useState('') // HH:MM

  async function loadIdeas(){
    const res = await fetch('/api/ideas', { credentials: 'include' })
    if (res.ok) setIdeas(await res.json())
  }
  useEffect(()=>{ loadIdeas() }, [])

  async function addIdea(){
    if (!title.trim()) return
    let finalUrl = ''
    if (file) {
      const form = new FormData()
      form.append('file', file)
      const up = await fetch('/api/upload', { method: 'POST', credentials: 'include', body: form })
      if (up.ok) {
        const data = await up.json();
        finalUrl = data.url
      }
    }
    const res = await fetch('/api/ideas', { method: 'POST', headers: { 'Content-Type':'application/json' }, credentials: 'include', body: JSON.stringify({ title, description, imageUrl: finalUrl }) })
    if (res.ok) { setTitle(''); setDescription(''); setFile(null); await loadIdeas() }
  }

  async function schedule(idea: Idea){
    // Open scheduling modal with defaults
    setScheduleIdea(idea)
    const today = new Date()
    const yyyy = today.getFullYear()
    const mm = String(today.getMonth() + 1).padStart(2, '0')
    const dd = String(today.getDate()).padStart(2, '0')
    setScheduleDate(`${yyyy}-${mm}-${dd}`)
    setScheduleTime('')
  }

  async function remove(id: string){
    if (!confirm('Delete this idea?')) return
    const res = await fetch('/api/ideas/'+id, { method: 'DELETE', credentials: 'include' })
    if (res.ok) await loadIdeas()
  }

  // Realtime updates via socket
  const { socket } = useAuth()
  useEffect(()=>{
    if (!socket) return
    const refresh = ()=> loadIdeas()
    socket.on('idea:created', refresh)
    socket.on('idea:deleted', refresh)
    socket.on('ideas:changed', refresh)
    return ()=>{
      socket.off('idea:created', refresh)
      socket.off('idea:deleted', refresh)
      socket.off('ideas:changed', refresh)
    }
  }, [socket])

  return (
    <div>
      <div className="row justify">
        <h2>Moodboard</h2>
        <button onClick={()=>setShow(true)}>+ Add idea</button>
      </div>
      <div className="grid">
        {ideas.map(i=> (
          <div className="card idea" key={i.id}>
            {i.imageUrl && <img src={i.imageUrl} alt="idea" />}
            <div className="title">{i.title}</div>
            {i.description && <div className="muted" style={{whiteSpace:'pre-wrap'}}>{i.description}</div>}
            <div className="row" style={{gap:8}}>
              <button
                className={i.myVote==='up' ? 'pill active' : 'pill'}
                onClick={async()=>{ await fetch(`/api/ideas/${i.id}/vote`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ vote: i.myVote==='up' ? null : 'up' }) }); await loadIdeas(); }}
              >👍 {i.votes?.up ?? 0}</button>
              <button
                className={i.myVote==='down' ? 'pill active' : 'pill'}
                onClick={async()=>{ await fetch(`/api/ideas/${i.id}/vote`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ vote: i.myVote==='down' ? null : 'down' }) }); await loadIdeas(); }}
              >👎 {i.votes?.down ?? 0}</button>
            </div>
            <div className="actions">
              <button onClick={()=>schedule(i)}>Schedule this</button>
              {user?.id === i.createdBy && (
                <button className="danger" onClick={()=>remove(i.id)}>Remove</button>
              )}
            </div>
          </div>
        ))}
      </div>
      {show && (
        <div className="overlay">
          <div className="card" style={{width: 480}}>
            <h3>New Idea</h3>
            <input placeholder="Title" value={title} onChange={(e:any)=>setTitle(e.target.value)} />
            <textarea placeholder="Description (optional)" value={description} onChange={(e:any)=>setDescription(e.target.value)} />
            {/* URL input removed; use file upload below */}
            <input type="file" accept="image/*" onChange={(e:any)=>setFile(e.target.files?.[0]||null)} />
            <div className="row" style={{justifyContent:'flex-end'}}>
              <button onClick={()=>setShow(false)}>Cancel</button>
              <button onClick={async()=>{ await addIdea(); setShow(false) }}>Add</button>
            </div>
          </div>
        </div>
      )}
      {scheduleIdea && (
        <div className="overlay">
          <div className="card" style={{ width: 420 }}>
            <h3>Schedule: {scheduleIdea.title}</h3>
            <div className="col">
              <label>Date</label>
              <input
                type="date"
                value={scheduleDate}
                onChange={(e:any)=>setScheduleDate(e.target.value)}
              />
            </div>
            <div className="col">
              <label>Time</label>
              <input
                type="time"
                value={scheduleTime}
                onChange={(e:any)=>setScheduleTime(e.target.value)}
              />
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button onClick={()=>{ setScheduleIdea(null); setScheduleTime(''); }}>Cancel</button>
              <button
                onClick={async ()=>{
                  if (!scheduleDate || !scheduleTime) return;
                  const dateTime = `${scheduleDate}T${scheduleTime}`
                  const res = await fetch('/api/events', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ title: scheduleIdea.title, date: dateTime, ideaId: scheduleIdea.id })
                  })
                  if (res.ok) {
                    alert('Event scheduled! Check the calendar.')
                    setScheduleIdea(null)
                    setScheduleTime('')
                  }
                }}
                disabled={!scheduleDate || !scheduleTime}
              >Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
