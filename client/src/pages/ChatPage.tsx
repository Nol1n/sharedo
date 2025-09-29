import React, { useEffect, useMemo, useRef, useState } from 'react'
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

  // Live update avatars/usernames when a user updates their profile
  useEffect(()=>{
    if (!socket) return
    const onUserUpdated = (u: { id: string; username: string; avatarUrl?: string }) => {
      setRoomDetails(prev => {
        if (!prev || !(prev as any).members) return prev as any
        const members = (prev as any).members.map((m:any)=> m.id===u.id ? { ...m, username: u.username, avatarUrl: u.avatarUrl } : m)
        return { ...prev, members } as any
      })
      setMsgs(prev => prev.map(m => m.senderId===u.id ? { ...m, senderName: u.username, avatarUrl: u.avatarUrl } : m))
    }
    socket.on('user:updated', onUserUpdated)
    return ()=> { socket.off('user:updated', onUserUpdated) }
  }, [socket])

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

  // Helpers for day separators (Discord-like)
  function isSameDay(a: Date, b: Date){
    return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate()
  }
  function dayKeyFromTs(ts: number){
    const d = new Date(ts)
    const y = d.getFullYear(); const m = (d.getMonth()+1).toString().padStart(2,'0'); const day = d.getDate().toString().padStart(2,'0')
    return `${y}-${m}-${day}`
  }
  function dayLabel(ts: number){
    const d = new Date(ts)
    const now = new Date()
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate()-1)
    if (isSameDay(d, now)) return "Aujourd'hui"
    if (isSameDay(d, yesterday)) return 'Hier'
    if (d.getFullYear() === now.getFullYear()) {
      return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(d)
    }
    return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(d)
  }

  const timeline = useMemo(()=>{
    const items: Array<{ type:'sep'; key:string; label:string } | { type:'msg'; key:string; msg: Msg }> = []
    let lastKey = ''
    for (const m of msgs) {
      const k = dayKeyFromTs(m.timestamp)
      if (k !== lastKey) {
        items.push({ type:'sep', key:'sep-'+k, label: dayLabel(m.timestamp) })
        lastKey = k
      }
      items.push({ type:'msg', key:m.id, msg: m })
    }
    return items
  }, [msgs])

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
    <div className="discord-chat">
      {/* Server Sidebar */}
      <div className="server-sidebar">
        <div className="server-list">
          {rooms.map(r=> (
            <div key={r.id} className={`server-item ${r.id===active?'active':''}`} onClick={()=>setActive(r.id)}>
              {r.imageUrl ? (
                <img src={r.imageUrl} alt={r.name} className="server-icon" />
              ) : (
                <div className="server-icon-text">{r.name.charAt(0).toUpperCase()}</div>
              )}
            </div>
          ))}
          <div className="server-item add-server" onClick={()=>setShowCreate(true)}>
            <div className="server-icon-text">+</div>
          </div>
        </div>
      </div>

      {/* Channel Sidebar */}
      <div className="channel-sidebar">
        <div className="channel-header">
          <h3>{roomDetails?.name || 'Select a room'}</h3>
          {roomDetails && roomDetails.id !== 'general' && (
            <button className="manage-btn" onClick={openManage} title="Edit group">
              ⚙️
            </button>
          )}
        </div>
        
        {roomDetails?.description && (
          <div className="channel-description">{roomDetails.description}</div>
        )}
        
        <div className="members-section">
          <h4>Members ({roomDetails?.memberIds?.length || 0})</h4>
          <div className="members-list">
            {roomDetails?.members?.map((member: any) => (
              <div key={member.id} className="member-item">
                <img src={member.avatarUrl || `https://api.dicebear.com/7.x/thumbs/svg?seed=${member.username}`} alt={member.username} />
                <span>{member.username}</span>
                {member.id === user?.id && <span className="you-badge">You</span>}
              </div>
            )) || []}
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="main-chat">
        <div className="chat-header">
          <h2>#{roomDetails?.name || 'general'}</h2>
          <div className="chat-info">
            {roomDetails?.description && <span className="chat-description">{roomDetails.description}</span>}
          </div>
        </div>
        
        <div className="messages-container">
          {timeline.map(item => item.type==='sep' ? (
            <div key={item.key} className="day-separator">
              <span className="line" />
              <span className="label">{item.label}</span>
              <span className="line" />
            </div>
          ) : (
            <div key={item.key} className={`message ${item.msg.senderId===user?.id?'own-message':''}`}>
              <img src={item.msg.avatarUrl || `https://api.dicebear.com/7.x/thumbs/svg?seed=${item.msg.senderName||'friend'}`} className="message-avatar" />
              <div className="message-content">
                <div className="message-header">
                  <span className="username">{item.msg.senderName||item.msg.senderId.slice(0,6)}</span>
                  <span className="timestamp">{new Date(item.msg.timestamp).toLocaleTimeString()}</span>
                </div>
                <div className="message-text">{item.msg.text}</div>
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        
        <div className="message-input-container">
          <div className="message-input">
            <input 
              value={text} 
              onChange={(e:any)=>setText(e.target.value)} 
              placeholder={`Message #${roomDetails?.name || 'general'}`} 
              onKeyDown={e=>{ if(e.key==='Enter') send() }} 
            />
            <button className="send-button" onClick={send} disabled={!text.trim()}>Send</button>
          </div>
        </div>
      </div>
      {showManage && roomDetails && (
        <div className="discord-modal-overlay">
          <div className="discord-modal">
            <div className="discord-modal-header">
              <h2>Server Settings</h2>
              <button className="close-btn" onClick={()=>{ setShowManage(false); setEditImageFile(null) }}>×</button>
            </div>
            
            <div className="discord-modal-content">
              <div className="setting-section">
                <h3>Server Overview</h3>
                <div className="form-group">
                  <label>Server Name</label>
                  <input 
                    value={editName} 
                    onChange={(e:any)=>setEditName(e.target.value)}
                    className="discord-input"
                  />
                </div>
                <div className="form-group">
                  <label>Server Description</label>
                  <textarea 
                    value={editDescription} 
                    onChange={(e:any)=>setEditDescription(e.target.value)}
                    className="discord-textarea"
                    placeholder="What's this server about?"
                  />
                </div>
                <div className="form-group">
                  <label>Server Icon</label>
                  <input 
                    type="file" 
                    accept="image/*" 
                    onChange={(e:any)=>setEditImageFile(e.target.files?.[0]||null)}
                    className="discord-file-input"
                  />
                </div>
              </div>
              
              <div className="setting-section">
                <h3>Members</h3>
                <div className="members-management">
                  <div className="selected-members">
                    {selectedMembers.map(m => (
                      <div key={m.id} className="member-tag">
                        <img src={m.avatarUrl || `https://api.dicebear.com/7.x/thumbs/svg?seed=${m.username}`} alt={m.username} />
                        <span>{m.username}</span>
                        <button onClick={()=>removeMember(m.id)} className="remove-member-btn">×</button>
                      </div>
                    ))}
                  </div>
                  <div className="member-search">
                    <input
                      placeholder="Search users to add..."
                      value={memberQuery}
                      onChange={(e:any)=>{ setMemberQuery(e.target.value); setShowResults(true) }}
                      onFocus={()=> setShowResults(true)}
                      className="discord-input"
                    />
                    {showResults && memberResults.length>0 && (
                      <div className="member-results">
                        {memberResults.map(u => (
                          <div key={u.id} onClick={()=>addMember(u)} className="member-result-item">
                            <img src={u.avatarUrl || `https://api.dicebear.com/7.x/thumbs/svg?seed=${u.username}`} alt={u.username} />
                            <span>{u.username}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            
            <div className="discord-modal-footer">
              {roomDetails && (roomDetails as any)['createdBy']===user?.id && (
                <button className="discord-btn-danger" onClick={async()=>{
                  if (!confirm('Are you sure you want to delete this server? This action cannot be undone.')) return;
                  await fetch(`/api/rooms/${roomDetails.id}`, { method:'DELETE', credentials:'include' })
                  setShowManage(false)
                  setRoomDetails(null)
                  await loadRooms()
                  setActive('general')
                }}>Delete Server</button>
              )}
              <div className="modal-actions">
                <button className="discord-btn-secondary" onClick={()=>{ setShowManage(false); setEditImageFile(null) }}>Cancel</button>
                {roomDetails && (roomDetails as any)['createdBy']===user?.id ? (
                  <button className="discord-btn-primary" onClick={saveManage}>Save Changes</button>
                ) : (
                  <div className="muted" style={{fontSize: '12px', color: 'var(--muted)'}}>
                    Only the group creator can make changes
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {showCreate && (
        <div className="discord-modal-overlay">
          <div className="discord-modal">
            <div className="discord-modal-header">
              <h2>Create Server</h2>
              <button className="close-btn" onClick={()=>{ setShowCreate(false); setNewRoomName(''); setNewRoomImageFile(null) }}>×</button>
            </div>
            
            <div className="discord-modal-content">
              <div className="setting-section">
                <h3>Server Details</h3>
                <div className="form-group">
                  <label>Server Name</label>
                  <input 
                    placeholder="Enter a server name" 
                    value={newRoomName} 
                    onChange={(e:any)=>setNewRoomName(e.target.value)}
                    className="discord-input"
                  />
                </div>
                <div className="form-group">
                  <label>Server Description</label>
                  <textarea 
                    placeholder="What's this server about?" 
                    value={newRoomDescription} 
                    onChange={(e:any)=>setNewRoomDescription(e.target.value)}
                    className="discord-textarea"
                  />
                </div>
                <div className="form-group">
                  <label>Server Icon</label>
                  <input 
                    type="file" 
                    accept="image/*" 
                    onChange={(e:any)=>setNewRoomImageFile(e.target.files?.[0]||null)}
                    className="discord-file-input"
                  />
                </div>
              </div>
              
              <div className="setting-section">
                <h3>Invite Members</h3>
                <div className="members-management">
                  <div className="selected-members">
                    {selectedNewMembers.map(m => (
                      <div key={m.id} className="member-tag">
                        <img src={m.avatarUrl || `https://api.dicebear.com/7.x/thumbs/svg?seed=${m.username}`} alt={m.username} />
                        <span>{m.username}</span>
                        <button onClick={()=>removeNewMember(m.id)} className="remove-member-btn">×</button>
                      </div>
                    ))}
                  </div>
                  <div className="member-search">
                    <input
                      placeholder="Search users to invite..."
                      value={newMemberQuery}
                      onChange={(e:any)=>{ setNewMemberQuery(e.target.value); setShowNewResults(true) }}
                      onFocus={()=> setShowNewResults(true)}
                      className="discord-input"
                    />
                    {showNewResults && newMemberResults.length>0 && (
                      <div className="member-results">
                        {newMemberResults.map(u => (
                          <div key={u.id} onClick={()=>addNewMember(u)} className="member-result-item">
                            <img src={u.avatarUrl || `https://api.dicebear.com/7.x/thumbs/svg?seed=${u.username}`} alt={u.username} />
                            <span>{u.username}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            
            <div className="discord-modal-footer">
              <div className="modal-actions">
                <button className="discord-btn-secondary" onClick={()=>{ setShowCreate(false); setNewRoomName(''); setNewRoomImageFile(null) }}>Cancel</button>
                <button className="discord-btn-primary" onClick={createRoom} disabled={!newRoomName.trim()}>Create Server</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
