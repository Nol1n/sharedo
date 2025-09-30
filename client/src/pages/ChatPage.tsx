import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNotifications } from '../notifications'
import { useAuth } from '../auth'

type Msg = { id: string; roomId?: string; senderId: string; senderName?: string; avatarUrl?: string; text: string; timestamp: number; replyTo?: string }
type Room = { id: string; name: string; memberIds: string[] }
type RoomDetails = Room & { imageUrl?: string; description?: string }

export default function ChatPage(){
  const { socket, user } = useAuth()
  const { clearMessages } = useNotifications()
  const [rooms, setRooms] = useState<RoomDetails[]>([])
  const [active, setActive] = useState<string>('general')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [pendingAttachments, setPendingAttachments] = useState<Array<{url:string; name?:string; type?:string}>>([])
  const [replyTarget, setReplyTarget] = useState<Msg|null>(null)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionResults, setMentionResults] = useState<Array<{id:string; username:string; avatarUrl?:string}>>([])
  const [showMentionResults, setShowMentionResults] = useState(false)
  const [hashQuery, setHashQuery] = useState('')
  const [hashResults, setHashResults] = useState<Array<any>>([])
  const [showHashResults, setShowHashResults] = useState(false)
  const hashTimer = useRef<number|undefined>(undefined)
  const inputRef = useRef<HTMLInputElement|null>(null)

  function selectMention(u: { id: string; username: string }){
    // replace the trailing @token with the selected username + space
    const v = text
    const newVal = v.replace(/(?:^|\s)@([a-zA-Z0-9_\-]{1,})$/, (m, p1)=> {
      const prefix = m.startsWith('@') ? '' : m.slice(0, m.indexOf('@'))
      return (prefix ? prefix + ' ' : '') + '@' + u.username + ' '
    })
    setText(newVal)
    setShowMentionResults(false)
    setMentionQuery('')
    // focus input again
    setTimeout(()=> inputRef.current?.focus(), 0)
  }
  const endRef = useRef<HTMLDivElement|null>(null)
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  function scrollToMessage(id: string){
    const el = messageRefs.current.get(id)
    if (!el) return
    // scroll smoothly and add a brief highlight
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('flash-highlight')
    setTimeout(()=> el.classList.remove('flash-highlight'), 1200)
  }
  const [showCreate, setShowCreate] = useState(false)
  const [newRoomName, setNewRoomName] = useState('')
  const [newRoomImageFile, setNewRoomImageFile] = useState<File|null>(null)
  const [newRoomDescription, setNewRoomDescription] = useState('')
  const [newMemberQuery, setNewMemberQuery] = useState('')
  const [newMemberResults, setNewMemberResults] = useState<Array<{id:string; username:string; avatarUrl?:string}>>([])
  const [selectedNewMembers, setSelectedNewMembers] = useState<Array<{id:string; username:string; avatarUrl?:string}>>([])
  const [showNewResults, setShowNewResults] = useState(false)
  const [roomDetails, setRoomDetails] = useState<RoomDetails|null>(null)
  const [openReactionFor, setOpenReactionFor] = useState<string|null>(null)
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
    // expose current room globally so notifications can ignore messages for the open room
    (window as any).sharedoChatActiveRoom = active
    return ()=> { (window as any).sharedoChatActiveRoom = null }
  }, [active])
  useEffect(()=>{ 
    if(active) { 
      // clear previous room messages immediately
      setMsgs([])
      // reset chat badge when user opens a room
      try { clearMessages() } catch(e){}
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

    // Listen for dropped images intended for room icon assignment
    useEffect(()=>{
      const handler = async (e: any) => {
        const d = e.detail || {}
        if (d.kind !== 'room') return
        if (!showManage || !roomDetails) return
        // Apply directly to room image via API
        try {
          await fetch(`/api/rooms/${roomDetails.id}`, { method: 'PUT', headers: { 'Content-Type':'application/json' }, credentials: 'include', body: JSON.stringify({ imageUrl: d.url }) })
          await loadRooms(); await loadRoomDetails(roomDetails.id)
        } catch (err) { console.error('Failed to set room icon', err) }
      }
      window.addEventListener('sharedo:dropped', handler as any)
      return ()=> window.removeEventListener('sharedo:dropped', handler as any)
    }, [showManage, roomDetails])
  useEffect(()=>{
    if (!socket) return
    const handler = (m:Msg)=> {
      if (m.roomId === active) {
        setMsgs(prev=>[...prev, m])
        // ensure badge cleared when receiving message for currently open room
        try { clearMessages() } catch(e){}
      }
    }
    const onRoomUpdated = (data:any)=>{
      // Refresh rooms list and details if current room updated
      loadRooms()
      if (roomDetails && data.id === roomDetails.id) loadRoomDetails(roomDetails.id)
    }
    const onReactionChanged = (d:any) => {
      if (d.targetType === 'message' && d.targetId) loadMessages(active)
    }
    const onPresence = (p:any) => {
      // reload rooms to update member counts
      loadRooms()
      // also update current room member online flags if present
      setRoomDetails(prev => {
        if (!prev || !prev.members) return prev
        const members = (prev.members as any[]).map(m => m.id === p.userId ? { ...m, online: p.online } : m)
        return { ...prev, members } as any
      })
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
  socket.on('reaction:changed', onReactionChanged)
    socket.on('room:deleted', onRoomDeleted)
    socket.on('connect', onConnect)
    socket.on('rooms:changed', loadRooms)
  socket.on('presence:changed', onPresence)
    // join room
    socket.emit('chat:join', { roomId: active })
    return ()=>{
      socket.off('chat:message', handler)
      socket.off('room:updated', onRoomUpdated)
      socket.off('reaction:changed', onReactionChanged)
      socket.off('room:deleted', onRoomDeleted)
      socket.off('connect', onConnect)
      socket.off('rooms:changed', loadRooms)
      socket.off('presence:changed', onPresence)
      socket.emit('chat:leave', { roomId: active })
    }
  }, [socket, active, roomDetails])

  function send(){
    if ((!text || !text.trim()) && pendingAttachments.length === 0) return
    if (!socket) return
    socket.emit('chat:newMessage', { text, roomId: active, replyTo: replyTarget?.id, attachments: pendingAttachments })
    setText('')
    setReplyTarget(null)
    setPendingAttachments([])
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

  // Render message text and highlight @mentions. Mentions that match current user's
  // username get a special "mention-me" class.
  function renderMessageText(text: string): React.ReactNode {
    if (!text) return null
    const parts: React.ReactNode[] = []
    const re = /@([a-zA-Z0-9_\-]+)/g
    let lastIndex = 0
    let m: RegExpExecArray | null
    let idx = 0
    while ((m = re.exec(text)) !== null) {
      const start = m.index
      const username = m[1]
      if (start > lastIndex) parts.push(text.slice(lastIndex, start))
      const isMe = !!(user && user.username && user.username.toLowerCase() === username.toLowerCase())
      parts.push(
        <span key={`mention-${idx}-${start}`} className={"mention" + (isMe ? ' mention-me' : '')}>{'@' + username}</span>
      )
      lastIndex = re.lastIndex
      idx++
    }
    if (lastIndex < text.length) parts.push(text.slice(lastIndex))
    return <>{parts.map((p, i) => typeof p === 'string' ? <React.Fragment key={"t-"+i}>{p}</React.Fragment> : p)}</>
  }

  // Simple cache for event metadata used in inline previews
  const eventCache = useRef<Map<string, any>>(new Map())

  function EventPreview({ id }: { id: string }){
    const [ev, setEv] = useState<any|null>(eventCache.current.get(id) || null)
    useEffect(()=>{
      if (ev) return
      let mounted = true
      fetch('/api/events/' + encodeURIComponent(id), { credentials: 'include' }).then(r=> r.ok ? r.json() : null).then((data:any)=>{ if (!mounted) return; setEv(data); eventCache.current.set(id, data) }).catch(()=>{})
      return ()=>{ mounted = false }
    }, [id])
    if (!ev) return <div className="event-preview" aria-hidden><div style={{width:68,height:68,background:'#eee',borderRadius:8}} /></div>
    // group availability by status
    const yes = (ev.availability || []).filter((a:any)=>a.status === 'yes')
    const no = (ev.availability || []).filter((a:any)=>a.status === 'no')
    const maybe = (ev.availability || []).filter((a:any)=>a.status === 'maybe')
    const maxAv = 5
    const renderAvatars = (arr:any[]) => {
      const shown = arr.slice(0, maxAv)
      const more = Math.max(0, arr.length - shown.length)
      return (
        <>
          {shown.map((a:any, i:number)=> (
            <img key={a.id||a.userId||i} src={a.avatarUrl||`https://api.dicebear.com/7.x/thumbs/svg?seed=${a.username||a.userId||i}`} title={a.username||a.userId} alt={a.username||a.userId} className="vote-avatar" />
          ))}
          {more>0 && (
            <div className="more-count">+{more}</div>
          )}
        </>
      )
    }

    return (
      <div className="event-preview" role="group">
        <img src={ev.idea && ev.idea.imageUrl ? ev.idea.imageUrl : (ev.imageUrl || `https://api.dicebear.com/7.x/thumbs/svg?seed=${ev.title}`)} alt={ev.title} />
        <div className="event-preview-body">
          <div className="event-preview-title">{ev.title}</div>
          <div className="event-preview-meta">{new Date(ev.date).toLocaleString()} · {ev.location || ''}</div>
          <div className="event-preview-lists">
            { (ev.shopping || []).slice(0,3).map((s:any)=> <div key={s.id} className="chip">{s.item}</div>) }
          </div>

          <div className="event-votes">
            <div className="vote-group">
              <div className="vote-label">Oui <span className="vote-count">{yes.length}</span></div>
              <div className="vote-avatars">
                {renderAvatars(yes)}
              </div>
            </div>

            <div className="vote-group">
              <div className="vote-label">Non <span className="vote-count">{no.length}</span></div>
              <div className="vote-avatars">
                {renderAvatars(no)}
              </div>
            </div>

            <div className="vote-group">
              <div className="vote-label">NSP <span className="vote-count">{maybe.length}</span></div>
              <div className="vote-avatars">
                {renderAvatars(maybe)}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Replace #<id> tokens in message text with inline EventPreview components
  function renderMessageWithEvents(text: string){
    if (!text) return null
    const parts: React.ReactNode[] = []
  const re = /#event:([a-zA-Z0-9\-]+)/g
    let last = 0; let m: RegExpExecArray | null; let idx = 0
    while ((m = re.exec(text)) !== null){
      const start = m.index
      if (start > last) parts.push(renderMessageText(text.slice(last, start)))
      const id = m[1]
      parts.push(<React.Fragment key={'ev-'+idx+'-'+id}><EventPreview id={id} /></React.Fragment>)
      last = re.lastIndex
      idx++
    }
    if (last < text.length) parts.push(renderMessageText(text.slice(last)))
    return <>{parts.map((p,i)=> typeof p === 'string' ? <React.Fragment key={'mt-'+i}>{p}</React.Fragment> : p)}</>
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

  // Debounced search for events when typing after # token
  useEffect(()=>{
    if (!hashQuery) return setShowHashResults(false)
    // clear previous timer
    if (hashTimer.current) window.clearTimeout(hashTimer.current)
    hashTimer.current = window.setTimeout(async ()=>{
      try {
        const res = await fetch('/api/events/search?q=' + encodeURIComponent(hashQuery), { credentials: 'include' })
        if (res.ok) {
          const data = await res.json()
          setHashResults(data || [])
          setShowHashResults((data||[]).length>0)
        } else {
          setHashResults([])
          setShowHashResults(false)
        }
      } catch (e) {
        setHashResults([])
        setShowHashResults(false)
      }
    }, 200)
    return ()=>{ if (hashTimer.current) window.clearTimeout(hashTimer.current) }
  }, [hashQuery])

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
          <h4>Members ({roomDetails?.members?.length || 0})</h4>
          <div className="members-list">
            {roomDetails?.members?.map((member: any) => (
              <div key={member.id} className="member-item">
                <img src={member.avatarUrl || `https://api.dicebear.com/7.x/thumbs/svg?seed=${member.username}`} alt={member.username} />
                <span className={"presence-dot " + (member.online ? 'presence-online' : 'presence-offline')} title={member.online ? 'Online' : 'Offline'} />
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
            <div key={item.key} className={`message ${item.msg.senderId===user?.id?'own-message':''} ${item.msg.replyTo ? 'has-reply-connector' : ''}`} ref={(el)=>{ if (el) messageRefs.current.set(item.msg.id, el); else messageRefs.current.delete(item.msg.id) }}>
              <img src={item.msg.avatarUrl || `https://api.dicebear.com/7.x/thumbs/svg?seed=${item.msg.senderName||'friend'}`} className="message-avatar" />
              {item.msg.replyTo && (
                <div className="message-connector" onClick={()=>{ if (item.msg.replyTo) scrollToMessage(item.msg.replyTo) }}>
                  <div className="connector-line" />
                </div>
              )}
              <div className="message-content">
                <div className="message-header">
                  <span className="username">{item.msg.senderName||item.msg.senderId.slice(0,6)}</span>
                  <span className="timestamp">{new Date(item.msg.timestamp).toLocaleTimeString()}</span>
                </div>
                {item.msg.replyTo && (
                  (()=>{
                    const parent = msgs.find(m=>m.id===item.msg.replyTo)
                    return (
                      <>
                        <div className="message-reply-block" onClick={()=>{ if (item.msg.replyTo) scrollToMessage(item.msg.replyTo) }} role="button" tabIndex={0}>
                          <div className="reply-bar" aria-hidden="true" />
                          <div className="reply-body">
                            <img className="reply-avatar" src={parent?.avatarUrl || `https://api.dicebear.com/7.x/thumbs/svg?seed=${parent?.senderName||'anon'}`} alt={parent?.senderName||'user'} />
                            <div className="reply-meta">
                              <div className="reply-username">{parent?.senderName || 'Unknown'}</div>
                              <div className="reply-snippet">{(parent?.text || '').slice(0,120)}</div>
                            </div>
                          </div>
                        </div>
                      </>
                    )
                  })()
                )}
                {/* reply button shown on hover via CSS */}
                <div className="message-text-row">
                  <div className="message-text">
                    {renderMessageWithEvents(item.msg.text)}
                    {item.msg.attachments && item.msg.attachments.length>0 && (
                      <div className="message-attachments" style={{marginTop:8, display:'flex', gap:8, flexDirection:'column'}}>
                        {item.msg.attachments.map((a:any, idx:number)=> (
                          <div key={idx} style={{display:'flex', alignItems:'center', gap:8}}>
                            {a.type && a.type.startsWith && a.type.startsWith('image/') ? (
                              <img src={a.url} style={{width:160,height:100,objectFit:'cover',borderRadius:8}} alt={a.name||'img'} />
                            ) : (
                              <a href={a.url} target="_blank" rel="noreferrer" style={{display:'inline-flex',alignItems:'center',gap:8}}>{a.name || 'Fichier'}</a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button className="reply-btn" title="Reply" onClick={()=> setReplyTarget(item.msg)}>↩</button>
                </div>
                {/* Visible reaction bar showing existing reactions */}
                <div className="reaction-bar">
                  {(item.msg.reactions || []).map((r:any) => (
                    <button key={r.emoji} className={`reaction-pill ${r.reactedByMe ? 'active' : ''}`} onClick={async ()=>{
                      // toggle reaction
                      if (r.reactedByMe) {
                        await fetch('/api/reactions', { method: 'DELETE', headers: {'Content-Type':'application/json'}, credentials: 'include', body: JSON.stringify({ targetType: 'message', targetId: item.msg.id, emoji: r.emoji }) })
                      } else {
                        await fetch('/api/reactions', { method: 'POST', headers: {'Content-Type':'application/json'}, credentials: 'include', body: JSON.stringify({ targetType: 'message', targetId: item.msg.id, emoji: r.emoji }) })
                      }
                      await loadMessages(active)
                    }}>{r.emoji} {r.count}</button>
                  ))}
                </div>

                <div className="message-reactions" style={{position:'relative'}}>
                  <div className="reaction-trigger" onClick={(e)=>{ e.stopPropagation(); setOpenReactionFor(openReactionFor===item.msg.id?null:item.msg.id) }} title="Add reaction">🙂</div>
                  {openReactionFor === item.msg.id && (
                    <div className="reaction-overlay" onClick={e=>e.stopPropagation()} style={{display:'flex', gap:8}}>
                      {/* small emoji picker for adding new reactions */}
                      {['👍','❤️','😂','😮','🎉'].map(e=> (
                        <button key={e} className="reaction-pill" onClick={async ()=>{ await fetch('/api/reactions', { method: 'POST', headers: {'Content-Type':'application/json'}, credentials: 'include', body: JSON.stringify({ targetType: 'message', targetId: item.msg.id, emoji: e }) }); await loadMessages(active); setOpenReactionFor(null) }}>{e}</button>
                      ))}
                      <button className="reaction-close" onClick={()=>setOpenReactionFor(null)}>×</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        
        <div className="message-input-container">
          <div className="message-input" style={{ position: 'relative' }}>
            {replyTarget && (
              <div className="active-reply">
                <div className="active-reply-left">
                  <img src={replyTarget.avatarUrl || `https://api.dicebear.com/7.x/thumbs/svg?seed=${replyTarget.senderName||'u'}`} alt="reply" />
                </div>
                <div className="active-reply-body">
                  <div className="active-reply-meta">Replying to <strong>{replyTarget.senderName||replyTarget.senderId.slice(0,6)}</strong></div>
                  <div className="active-reply-text">{replyTarget.text.slice(0,120)}</div>
                </div>
                <button className="active-reply-cancel" onClick={()=>setReplyTarget(null)} title="Cancel reply">×</button>
              </div>
            )}
            <div style={{display:'flex', gap:8, alignItems:'center'}}>
              <input 
                ref={inputRef}
                value={text} 
                onChange={(e:any)=>{
                  const v = e.target.value
                  console.debug('[chat] input onChange, text=', v)
                  setText(v)
                  // detect mention token at end of input
                  const m = v.match(/(?:^|\s)@([a-zA-Z0-9_\-]{1,})$/)
                  if (m && roomDetails && (roomDetails as any).members) {
                    const q = m[1]
                    console.debug('[chat] mention token detected, q=', q, 'membersCount=', (roomDetails as any).members.length)
                    setMentionQuery(q)
                    const members = (roomDetails as any).members as Array<{id:string; username:string; avatarUrl?:string}>
                    const res = members.filter(u => u.username.toLowerCase().startsWith(q.toLowerCase()) ).slice(0,8)
                    console.debug('[chat] mention results:', res.map(r=>r.username))
                    setMentionResults(res)
                    setShowMentionResults(res.length>0)
                  } else {
                    setShowMentionResults(false)
                    setMentionQuery('')
                  }
                  // detect hash token like #event (start search, debounced)
                  const h = v.match(/(?:^|\s)#([a-zA-Z0-9_\-]{1,})$/)
                  if (h) {
                    const q2 = h[1]
                    console.debug('[chat] hash token detected, q=', q2)
                    setHashQuery(q2)
                  } else {
                    setShowHashResults(false)
                    setHashQuery('')
                  }
                }} 
                placeholder={`Message #${roomDetails?.name || 'general'}`} 
                onKeyDown={e=>{ if(e.key==='Enter') { e.preventDefault(); send() } }} 
                style={{flex:1, height:40, padding:'8px 12px'}}
              />

              {/* Debug: mention autocomplete dropdown (temporary) */}
              {showMentionResults && mentionResults.length>0 && (
                <div className="mention-results debug-outline" style={{position:'absolute', bottom:54, left:8, background:'white', border:'1px solid rgba(0,0,0,0.12)', borderRadius:6, boxShadow:'0 6px 18px rgba(0,0,0,0.08)', zIndex:40, width:320, maxHeight:240, overflow:'auto'}}>
                  {mentionResults.map(u=> (
                    <div key={u.id} onClick={()=>selectMention(u)} style={{display:'flex',gap:8,alignItems:'center',padding:'8px',cursor:'pointer'}}>
                      <img src={u.avatarUrl || `https://api.dicebear.com/7.x/thumbs/svg?seed=${u.username}`} alt={u.username} style={{width:28,height:28,borderRadius:6}} />
                      <div style={{fontSize:13}}>{u.username}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Debug: hash/event autocomplete dropdown (temporary) */}
              {showHashResults && hashResults.length>0 && (
                <div className="hash-results debug-outline" style={{position:'absolute', bottom:54, left:8, background:'white', border:'1px solid rgba(0,0,0,0.12)', borderRadius:6, boxShadow:'0 6px 18px rgba(0,0,0,0.08)', zIndex:40, width:360, maxHeight:300, overflow:'auto'}}>
                  {hashResults.map((ev:any)=> (
                    <div key={ev.id} onClick={async ()=>{
                      // insert token into input
                      const before = text.replace(/(?:^|\s)#([a-zA-Z0-9_\-]{1,})$/, (m,p1)=> { const prefix = m.startsWith('#') ? '' : m.slice(0, m.indexOf('#')); return (prefix?prefix+' ':'') + '#event:' + ev.id + ' ' })
                      setText(before)
                      setShowHashResults(false)
                      setHashQuery('')
                      // focus back
                      setTimeout(()=> inputRef.current?.focus(), 0)
                    }} style={{display:'flex',gap:10,alignItems:'center',padding:'8px',cursor:'pointer'}}>
                      <img src={ev.imageUrl || (ev.idea && ev.idea.imageUrl) || `https://api.dicebear.com/7.x/thumbs/svg?seed=${ev.title}`} alt={ev.title} style={{width:44,height:44,borderRadius:6,objectFit:'cover'}} />
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,fontWeight:600}}>{ev.title}</div>
                        <div style={{fontSize:12,color:'var(--muted)'}}>{ev.date ? new Date(ev.date).toLocaleString() : ''} {ev.location? '· '+ev.location : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <label className="attach-btn" style={{display:'inline-flex', alignItems:'center', gap:8, cursor:'pointer', height:40, padding:'6px 10px'}}>
                📎
                <input type="file" style={{display:'none'}} onChange={async (e:any)=>{
                  const f = e.target.files?.[0]
                  if (!f) return
                  const form = new FormData(); form.append('file', f)
                  const up = await fetch('/api/upload', { method:'POST', credentials:'include', body: form })
                  if (!up.ok) return
                  const data = await up.json()
                  const url = data.url
                  setPendingAttachments(prev => [...prev, { url, name: f.name, type: f.type }])
                  e.target.value = ''
                }} /></label>

              <button className="send-button" onClick={send} disabled={!(text.trim() || pendingAttachments.length>0)} style={{height:40, padding:'0 14px'}}>Send</button>
            </div>

            {pendingAttachments.length>0 && (
              <div style={{display:'flex', gap:8, alignItems:'center', marginTop:8}}>
                {pendingAttachments.map((a,i)=> (
                  <div key={i} style={{display:'flex', gap:6, alignItems:'center', background:'#fafafa', padding:'4px 8px', borderRadius:8, border:'1px solid var(--border)'}}>
                    {a.type && a.type.startsWith('image/') ? <img src={a.url} style={{width:36,height:36,objectFit:'cover',borderRadius:6}} /> : <div style={{width:36,height:36,display:'grid',placeItems:'center',background:'#eee',borderRadius:6}}>{a.name?.split('.').pop()||'F'}</div>}
                    <div style={{fontSize:12,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.name}</div>
                    <button onClick={()=> setPendingAttachments(prev => prev.filter((_,j)=>j!==i))} style={{border:'none',background:'transparent',cursor:'pointer'}}>×</button>
                  </div>
                ))}
              </div>
            )}
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
