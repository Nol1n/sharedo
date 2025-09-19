import React, { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth'

type Msg = { id: string; roomId?: string; senderId: string; senderName?: string; avatarUrl?: string; text: string; timestamp: number }
type Room = { id: string; name: string; memberIds: string[] }
type RoomDetails = Room & { imageUrl?: string; description?: string }

export default function ChatPage(){
  const { socket, user } = useAuth()
  const [rooms, setRooms] = useState<RoomDetails[]>([])
  const [active, setActive] = useState<string>('general')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const endRef = useRef<HTMLDivElement|null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newRoomName, setNewRoomName] = useState('')
  const [newRoomImageFile, setNewRoomImageFile] = useState<File|null>(null)
  const [newRoomDescription, setNewRoomDescription] = useState('')
  const [newMemberQuery, setNewMemberQuery] = useState('')
  const [newMemberResults, setNewMemberResults] = useState<Array<{id:string; username:string; avatarUrl?:string}>>([])
  const [selectedNewMembers, setSelectedNewMembers] = useState<Array<{id:string; username:string; avatarUrl?:string}>>([])
  const [showNewResults, setShowNewResults] = useState(false)
  const [roomDetails, setRoomDetails] = useState<RoomDetails|null>(null)
  const [showManage, setShowManage] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editImageFile, setEditImageFile] = useState<File|null>(null)
  const [editMembers, setEditMembers] = useState<string>('')
  // Autocomplete state for members picker
  const [memberQuery, setMemberQuery] = useState('')
  const [memberResults, setMemberResults] = useState<Array<{id:string; username:string; avatarUrl?:string}>>([])
  const [selectedMembers, setSelectedMembers] = useState<Array<{id:string; username:string; avatarUrl?:string}>>([])
  const [showResults, setShowResults] = useState(false)

  useEffect(()=>{ endRef.current?.scrollIntoView({ behavior:'smooth' }) }, [msgs])

  async function loadRooms(){
    const res = await fetch('/api/rooms', { credentials:'include' })
    if (res.ok) setRooms(await res.json())
  }

  async function loadMessages(roomId: string){
    const res = await fetch(`/api/rooms/${roomId}/messages`, { credentials:'include' })
    if (res.ok) setMsgs(await res.json())
  }

  async function loadRoomDetails(roomId: string){
    const res = await fetch(`/api/rooms/${roomId}`, { credentials:'include' })
    if (res.ok) setRoomDetails(await res.json())
  }

  useEffect(()=>{ loadRooms() }, [])
  useEffect(()=>{ 
    if(active) { 
      setMsgs([]) // clear previous room messages immediately
      loadMessages(active); 
      loadRoomDetails(active) 
    } 
  }, [active])

  useEffect(()=>{
    if (!socket) return
    const handler = (m:Msg)=> {
      if (m.roomId === active) setMsgs(prev=>[...prev, m])
    }
    const onRoomUpdated = (data:any)=>{
      // Refresh rooms list and details if current room updated
      loadRooms()
      if (roomDetails && data.id === roomDetails.id) loadRoomDetails(roomDetails.id)
    }
    const onRoomDeleted = (data:any)=>{
      if (roomDetails && data.id === roomDetails.id) {
        setShowManage(false)
        setRoomDetails(null)
        loadRooms()
        setActive('general')
      } else {
        loadRooms()
      }
    }
    const onConnect = ()=>{ socket.emit('chat:join', { roomId: active }) }
    socket.on('chat:message', handler)
    socket.on('room:updated', onRoomUpdated)
    socket.on('room:deleted', onRoomDeleted)
    socket.on('connect', onConnect)
    socket.on('rooms:changed', loadRooms)
    // join room
    socket.emit('chat:join', { roomId: active })
    return ()=>{
      socket.off('chat:message', handler)
      socket.off('room:updated', onRoomUpdated)
      socket.off('room:deleted', onRoomDeleted)
      socket.off('connect', onConnect)
      socket.off('rooms:changed', loadRooms)
      socket.emit('chat:leave', { roomId: active })
    }
  }, [socket, active, roomDetails])

  function send(){
    if (!text.trim() || !socket) return
    socket.emit('chat:newMessage', { text, roomId: active })
    setText('')
  }

  async function openManage(){
    if (!roomDetails) return
    setEditName(roomDetails.name)
    setEditDescription(roomDetails.description||'')
    setEditMembers(roomDetails.members?.map((m:any)=>m.id).join(',')||'')
    // initialize selectedMembers from roomDetails.members
    const init = (roomDetails as any).members || []
    setSelectedMembers(init)
    setMemberQuery('')
    setMemberResults([])
    setShowResults(false)
    setShowManage(true)
  }

  async function saveManage(){
    if (!roomDetails) return
    const payload:any = { name: editName, description: editDescription }
    if (selectedMembers.length) {
      const ids = selectedMembers.map(m=>m.id)
      if (user?.id) ids.push(user.id)
      payload.members = Array.from(new Set(ids))
    }
    if (editImageFile) {
      const form = new FormData(); form.append('file', editImageFile)
      const up = await fetch('/api/upload', { method:'POST', credentials:'include', body: form })
      if (up.ok) { const data = await up.json(); payload.imageUrl = data.url }
    } else if (roomDetails.imageUrl) {
      // keep existing icon explicitly if none selected
      payload.imageUrl = roomDetails.imageUrl
    }
    const res = await fetch(`/api/rooms/${roomDetails.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(payload) })
    if (res.ok) {
      await loadRooms();
      await loadRoomDetails(roomDetails.id)
      setShowManage(false)
      setEditImageFile(null)
    }
  }

  // Search users for autocomplete
  useEffect(()=>{
    let ac = new AbortController()
    const run = async ()=>{
      const q = memberQuery.trim()
      if (!q) { setMemberResults([]); return }
      const res = await fetch('/api/users/search?q=' + encodeURIComponent(q), { credentials:'include', signal: ac.signal as any })
      if (res.ok) {
        const data = await res.json()
        // filter out already selected
        const selIds = new Set(selectedMembers.map(m=>m.id))
        setMemberResults(data.filter((u:any)=>!selIds.has(u.id)))
      }
    }
    run().catch(()=>{})
    return ()=> ac.abort()
  }, [memberQuery, selectedMembers])

  function addMember(u: {id:string; username:string; avatarUrl?:string}){
    if (selectedMembers.find(m=>m.id===u.id)) return
    setSelectedMembers([...selectedMembers, u])
    setMemberQuery('')
    setMemberResults([])
    setShowResults(false)
  }

  function removeMember(id: string){
    setSelectedMembers(selectedMembers.filter(m=>m.id!==id))
  }

  async function createRoom(){
    if (!newRoomName.trim()) return
  const members = Array.from(new Set([
    ...selectedNewMembers.map(m=>m.id),
    user?.id || ''
  ].filter(Boolean)))
  const payload:any = { name: newRoomName.trim(), description: newRoomDescription.trim(), members }
    if (newRoomImageFile) {
      const form = new FormData()
      form.append('file', newRoomImageFile)
      const up = await fetch('/api/upload', { method:'POST', credentials:'include', body: form })
      if (up.ok) { const data = await up.json(); payload.imageUrl = data.url }
    }
    const res = await fetch('/api/rooms', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(payload) })
    if (res.ok) {
      const r = await res.json()
      await loadRooms();
      setActive(r.id)
      setShowCreate(false)
      setNewRoomName('')
      setNewRoomImageFile(null)
      setNewRoomDescription('')
      setSelectedNewMembers([])
      setNewMemberQuery('')
    }
  }

  // Create modal autocomplete behavior
  useEffect(()=>{
    let ac = new AbortController()
    const run = async ()=>{
      const q = newMemberQuery.trim()
      if (!q) { setNewMemberResults([]); return }
      const res = await fetch('/api/users/search?q=' + encodeURIComponent(q), { credentials:'include', signal: ac.signal as any })
      if (res.ok) {
        const data = await res.json()
        const selIds = new Set(selectedNewMembers.map(m=>m.id))
        setNewMemberResults(data.filter((u:any)=>!selIds.has(u.id)))
      }
    }
    run().catch(()=>{})
    return ()=> ac.abort()
  }, [newMemberQuery, selectedNewMembers])

  function addNewMember(u: {id:string; username:string; avatarUrl?:string}){
    if (selectedNewMembers.find(m=>m.id===u.id)) return
    setSelectedNewMembers([...selectedNewMembers, u])
    setNewMemberQuery('')
    setNewMemberResults([])
    setShowNewResults(false)
  }

  function removeNewMember(id: string){
    setSelectedNewMembers(selectedNewMembers.filter(m=>m.id!==id))
  }

  return (
    <div className="chat">
      <div className="roombar">
        <div className="rooms">
          {rooms.map(r=> (
            <span key={r.id} className={'pill'+(r.id===active?' active':'')} onClick={()=>setActive(r.id)}>
              {r.imageUrl && <img src={r.imageUrl} style={{ width: 16, height: 16, borderRadius: 4, marginRight: 6 }} />}
              {r.name}
            </span>
          ))}
        </div>
        <button onClick={()=>setShowCreate(true)}>+ New room</button>
      </div>
      <div className="chatWindow">
        {roomDetails?.description && (
          <div className="muted" style={{marginBottom:12}}>{roomDetails.description}</div>
        )}
        {msgs.map(m=> (
          <div key={m.id} className="msg" style={{flexDirection: m.senderId===user?.id?'row-reverse':'row'}}>
            <img src={m.avatarUrl || 'https://api.dicebear.com/7.x/thumbs/svg?seed='+ (m.senderName||'friend')} />
            <div className="bubble" style={{background: m.senderId===user?.id?'#edeaf1':'#faf9f6'}}>
              <div className="meta"><strong>{m.senderName||m.senderId.slice(0,6)}</strong> · {new Date(m.timestamp).toLocaleTimeString()}</div>
              <div className="text">{m.text}</div>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="composer">
        <input value={text} onChange={(e:any)=>setText(e.target.value)} placeholder="Type a message" onKeyDown={e=>{ if(e.key==='Enter') send() }} />
        {roomDetails && roomDetails.id!== 'general' && roomDetails && roomDetails['createdBy']===user?.id && (
          <button onClick={openManage}>Manage room</button>
        )}
        <button onClick={send}>Send</button>
      </div>
      {showManage && roomDetails && (
        <div className="overlay">
          <div className="card" style={{ width: 520 }}>
            <h3>Manage room</h3>
            <label>Name</label>
            <input value={editName} onChange={(e:any)=>setEditName(e.target.value)} />
            <label>Description</label>
            <textarea value={editDescription} onChange={(e:any)=>setEditDescription(e.target.value)} />
            <label>Icon</label>
            <input type="file" accept="image/*" onChange={(e:any)=>setEditImageFile(e.target.files?.[0]||null)} />
            <label>Members</label>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:8 }}>
              {selectedMembers.map(m => (
                <span key={m.id} style={{ display:'inline-flex', alignItems:'center', padding:'4px 8px', borderRadius:16, background:'#f0f0f0' }}>
                  <img src={m.avatarUrl || 'https://api.dicebear.com/7.x/thumbs/svg?seed='+m.username} style={{ width:18, height:18, borderRadius:'50%', marginRight:6 }} />
                  {m.username}
                  <button onClick={()=>removeMember(m.id)} style={{ marginLeft:6, border:'none', background:'transparent', cursor:'pointer' }}>×</button>
                </span>
              ))}
            </div>
            <div style={{ position:'relative' }}>
              <input
                placeholder="Search users by name"
                value={memberQuery}
                onChange={(e:any)=>{ setMemberQuery(e.target.value); setShowResults(true) }}
                onFocus={()=> setShowResults(true)}
              />
              {showResults && memberResults.length>0 && (
                <div style={{ position:'absolute', top:'100%', left:0, right:0, background:'#fff', border:'1px solid #ddd', borderRadius:6, zIndex:10, maxHeight:200, overflowY:'auto' }}>
                  {memberResults.map(u => (
                    <div key={u.id} onClick={()=>addMember(u)} style={{ display:'flex', alignItems:'center', padding:8, cursor:'pointer' }}>
                      <img src={u.avatarUrl || 'https://api.dicebear.com/7.x/thumbs/svg?seed='+u.username} style={{ width:24, height:24, borderRadius:'50%', marginRight:8 }} />
                      <span>{u.username}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="row" style={{ justifyContent:'space-between', alignItems:'center' }}>
              {roomDetails && (roomDetails as any)['createdBy']===user?.id && (
                <button className="danger" onClick={async()=>{
                  if (!confirm('Delete this room?')) return;
                  await fetch(`/api/rooms/${roomDetails.id}`, { method:'DELETE', credentials:'include' })
                  setShowManage(false)
                  setRoomDetails(null)
                  await loadRooms()
                  setActive('general')
                }}>Delete room</button>
              )}
              <div style={{ display:'flex', gap:8 }}>
              <button onClick={()=>{ setShowManage(false); setEditImageFile(null) }}>Cancel</button>
              <button onClick={saveManage}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showCreate && (
        <div className="overlay">
          <div className="card" style={{ width: 420 }}>
            <h3>Create a new room</h3>
            <input placeholder="Room name" value={newRoomName} onChange={(e:any)=>setNewRoomName(e.target.value)} />
            <textarea placeholder="Description (optional)" value={newRoomDescription} onChange={(e:any)=>setNewRoomDescription(e.target.value)} />
            <input type="file" accept="image/*" onChange={(e:any)=>setNewRoomImageFile(e.target.files?.[0]||null)} />
            <label>Members</label>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:8 }}>
              {selectedNewMembers.map(m => (
                <span key={m.id} style={{ display:'inline-flex', alignItems:'center', padding:'4px 8px', borderRadius:16, background:'#f0f0f0' }}>
                  <img src={m.avatarUrl || 'https://api.dicebear.com/7.x/thumbs/svg?seed='+m.username} style={{ width:18, height:18, borderRadius:'50%', marginRight:6 }} />
                  {m.username}
                  <button onClick={()=>removeNewMember(m.id)} style={{ marginLeft:6, border:'none', background:'transparent', cursor:'pointer' }}>×</button>
                </span>
              ))}
            </div>
            <div style={{ position:'relative' }}>
              <input
                placeholder="Search users by name"
                value={newMemberQuery}
                onChange={(e:any)=>{ setNewMemberQuery(e.target.value); setShowNewResults(true) }}
                onFocus={()=> setShowNewResults(true)}
              />
              {showNewResults && newMemberResults.length>0 && (
                <div style={{ position:'absolute', top:'100%', left:0, right:0, background:'#fff', border:'1px solid #ddd', borderRadius:6, zIndex:10, maxHeight:200, overflowY:'auto' }}>
                  {newMemberResults.map(u => (
                    <div key={u.id} onClick={()=>addNewMember(u)} style={{ display:'flex', alignItems:'center', padding:8, cursor:'pointer' }}>
                      <img src={u.avatarUrl || 'https://api.dicebear.com/7.x/thumbs/svg?seed='+u.username} style={{ width:24, height:24, borderRadius:'50%', marginRight:8 }} />
                      <span>{u.username}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="row" style={{ justifyContent:'flex-end' }}>
              <button onClick={()=>{ setShowCreate(false); setNewRoomName(''); setNewRoomImageFile(null) }}>Cancel</button>
              <button onClick={createRoom} disabled={!newRoomName.trim()}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
