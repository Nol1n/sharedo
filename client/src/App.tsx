import { Route, Routes, Navigate, Link, useNavigate } from 'react-router-dom'
import Moodboard from './pages/Moodboard'
import CalendarPage from './pages/CalendarPage'
import MapPage from './pages/MapPage'
import ChatPage from './pages/ChatPage'
import Login from './pages/Login'
import Register from './pages/Register'
import Profile from './pages/Profile'
import { AuthProvider, useAuth } from './auth'
import { useNotifications } from './notifications'

function Protected({ children }: { children: any }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  return children
}

function Layout() {
  const { user, logout } = useAuth()
  const nav = useNavigate()
  const { clear, count, messageCount, clearMessages } = useNotifications()
  return (
    <div className="app">
      <aside className="sidebar">
          <div className="logo-wrap">
            <div className="logo-ascii">Sharedo</div>
          </div>
          <div className="logo-divider" aria-hidden></div>
        <nav>
          <Link to="/moodboard">Moodboard</Link>
          <Link to="/calendar">Calendar</Link>
          <Link to="/map">Map</Link>
            <Link to="/chat" className="sidebar-link" onClick={() => { clearMessages(); }}>
              Chat {messageCount > 0 && <span className="nav-badge">{messageCount}</span>}
            </Link>
          <Link to="/profile">Profile</Link>
        </nav>
        {user && (
          <div className="userbox">
            <img src={user.avatarUrl || 'https://api.dicebear.com/7.x/thumbs/svg?seed=' + user.username} />
            <div>{user.username}</div>
            <button onClick={async()=>{ await logout(); nav('/login') }}>Logout</button>
          </div>
        )}
      </aside>
      <main className="content">
        <Routes>
          <Route path="/moodboard" element={<Protected><Moodboard/></Protected>} />
          <Route path="/calendar" element={<Protected><CalendarPage/></Protected>} />
          <Route path="/chat" element={<Protected><ChatPage/></Protected>} />
          <Route path="/profile" element={<Protected><Profile/></Protected>} />
          <Route path="/map" element={<Protected><MapPage/></Protected>} />
          <Route path="/" element={<Navigate to="/moodboard" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login/>} />
        <Route path="/register" element={<Register/>} />
        <Route path="/*" element={<Layout/>} />
      </Routes>
    </AuthProvider>
  )
}
