import React, { createContext, useContext, useEffect, useState } from 'react'
import { io, Socket } from 'socket.io-client'

export type User = { id: string; username: string; email: string; avatarUrl: string }

type AuthContextType = {
  user: User | null
  socket: Socket | null
  refreshProfile: () => Promise<void>
  login: (username: string, password: string) => Promise<void>
  register: (username: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>(null as any)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [socket, setSocket] = useState<Socket | null>(null)

  async function refreshProfile() {
    try {
      const res = await fetch('/api/profile', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setUser(data)
        connectSocket()
      } else {
        setUser(null)
        disconnectSocket()
      }
    } catch (e) { setUser(null); disconnectSocket() }
  }

  async function connectSocket() {
    if (!user || socket) return
    // ask backend for a short-lived token, then connect
    const tokRes = await fetch('/api/token', { credentials: 'include' })
    if (!tokRes.ok) return
    const { token } = await tokRes.json()
    const url = import.meta.env.DEV ? 'http://localhost:4000' : undefined
    const s = io(url, { withCredentials: true, auth: { token } })
    setSocket(s)
  }

  function disconnectSocket() {
    if (socket) { socket.disconnect(); setSocket(null) }
  }

  async function login(username: string, password: string) {
    disconnectSocket() // Disconnect old socket before login
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ username, password }) })
    if (!res.ok) throw new Error('Login failed')
    await refreshProfile()
  }
  async function register(username: string, email: string, password: string) {
    disconnectSocket() // Disconnect old socket before register
    const res = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ username, email, password }) })
    if (!res.ok) throw new Error('Register failed')
    await refreshProfile()
  }
  async function logout() {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' })
    setUser(null)
    disconnectSocket()
  }

  useEffect(() => { refreshProfile() }, [])

  useEffect(() => { connectSocket() }, [user])

  return (
    <AuthContext.Provider value={{ user, socket, refreshProfile, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
