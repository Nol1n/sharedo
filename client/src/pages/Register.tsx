import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'

export default function Register() {
  const { register } = useAuth()
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  return (
    <div className="centered">
      <div className="card">
        <h2>Register</h2>
        {error && <div className="error" style={{marginBottom:10}}>{error}</div>}
  <div className="form">
          <input placeholder="Username" value={username} onChange={(e:any)=>setUsername(e.target.value)} />
          <input placeholder="Email" value={email} onChange={(e:any)=>setEmail(e.target.value)} />
          <input placeholder="Password" type="password" value={password} onChange={(e:any)=>setPassword(e.target.value)} />
          <button onClick={async()=>{ try{ await register(username, email, password); nav('/moodboard') }catch(e:any){ setError(e.message||'Register failed') } }}>Create account</button>
        </div>
        <div className="muted" style={{marginTop:12}}>Have an account? <Link to="/login">Login</Link></div>
      </div>
    </div>
  )
}
