import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'

export default function Login() {
  const { login } = useAuth()
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  return (
    <div className="centered">
      <div className="card">
        <h2>Login</h2>
        {error && <div className="error" style={{marginBottom:10}}>{error}</div>}
        <div className="form">
          <input placeholder="Username" value={username} onChange={(e:any)=>setUsername(e.target.value)} />
          <input placeholder="Password" type="password" value={password} onChange={(e:any)=>setPassword(e.target.value)} />
          <button onClick={async()=>{ try{ await login(username, password); nav('/moodboard') }catch(e:any){ setError(e.message||'Login failed') } }}>Login</button>
        </div>
        <div className="muted">No account? <Link to="/register">Register</Link></div>
      </div>
    </div>
  )
}
