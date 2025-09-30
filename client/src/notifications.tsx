import React, { createContext, useContext, useState, useEffect } from 'react'
import { useAuth } from './auth'

type Notification = { id?: string; type: string; title?: string; body?: string; durationMs?: number }

const NotificationsContext = createContext({ count: 0, push: (n: Notification)=>{}, clear: ()=>{} } as any)

export function NotificationsProvider({ children }: { children: React.ReactNode }){
  const [list, setList] = useState<Notification[]>([])
  const [messageCount, setMessageCount] = useState<number>(0)
  const { socket } = useAuth()
  const timers = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(()=>{
    if (!socket) return
    const onNotif = (n:any) => {
      // If user is currently viewing the chat room for this message, ignore the notification
      try {
        const activeRoom = (window as any).sharedoChatActiveRoom || null
        if (n && n.type === 'message' && n.roomId && activeRoom && activeRoom === n.roomId) {
          // skip toast and badge increment
          return
        }
      } catch (e) {}
      const it: Notification = { id: String(Date.now()) + Math.random(), type: n.type, title: n.type, body: JSON.stringify(n), durationMs: 5000 }
      // Only increment chat badge for real message notifications emitted by server (when not viewing the room)
      try {
        if (n && n.type === 'message') setMessageCount(c => c + 1)
      } catch (e) {}
      push(it)
    }
    socket.on('notification', onNotif)
    return ()=> socket.off('notification', onNotif)
  }, [socket])

  function removeById(id: string){
    // clear timer if present
    const t = timers.current.get(id)
    if (t) { clearTimeout(t); timers.current.delete(id) }
    setList(l => l.filter(x => x.id !== id))
  }

  function push(n: Notification){
    const id = n.id || (String(Date.now()) + Math.random())
    const item = { ...n, id }
    setList(l => [item, ...l].slice(0,6))
    // schedule auto-dismiss unless durationMs is 0 or negative
    const dur = (n.durationMs === undefined) ? 5000 : n.durationMs
    if (dur > 0) {
      const t = setTimeout(()=> removeById(id), dur)
      timers.current.set(id, t)
    }
  }

  function clear(){
    // clear all timers
    for (const t of timers.current.values()) clearTimeout(t)
    timers.current.clear()
    setList([])
    // do not implicitly clear messageCount here — expose explicit API if callers want that
  }

  function clearMessages(){
    setMessageCount(0)
  }

  // cleanup on unmount
  useEffect(()=>{
    return ()=>{
      for (const t of timers.current.values()) clearTimeout(t)
      timers.current.clear()
    }
  }, [])

  return (
    <NotificationsContext.Provider value={{ count: list.length, push, clear, messageCount, clearMessages }}>
      {children}
      <div className="toast-stack">
        {list.map(t => (
          <div key={t.id} className="toast">
            <strong>{t.title}</strong>
            <div className="toast-body">{t.body}</div>
          </div>
        ))}
      </div>
    </NotificationsContext.Provider>
  )
}

export function useNotifications(){ return useContext(NotificationsContext) }
