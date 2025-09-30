import { type ChangeEvent, type FormEvent, useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'

export default function Login() {
  const { login } = useAuth()
  const nav = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const infoMessage = (location.state as any)?.message || ''
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password.trim()) {
      setError('Please fill in all fields')
      return
    }
    
    setIsLoading(true)
    setError('')
    
    try {
  await login(username, password, code)
      nav('/moodboard')
    } catch (e: any) {
      setError(e.message || 'Login failed')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-background">
        <div className="auth-shapes">
          <div className="shape shape-1"></div>
          <div className="shape shape-2"></div>
          <div className="shape shape-3"></div>
        </div>
      </div>
      
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-logo">
            <div className="logo-icon">S</div>
            <h1>Sharedo</h1>
          </div>
          <p className="auth-subtitle">Welcome back! Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {infoMessage && (
            <div className="auth-info" style={{ background: '#fff9e6', border: '1px solid #f0e0b4', padding: 10, borderRadius: 8, marginBottom: 10 }}>
              {infoMessage}
            </div>
          )}
          {error && (
            <div className="auth-error">
              <span className="error-icon">⚠️</span>
              {error}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="username">Username</label>
            <div className="input-wrapper">
              <span className="input-icon">👤</span>
              <input
                id="username"
                type="text"
                placeholder="Enter your username"
                value={username}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setUsername(e.target.value)}
                className="auth-input"
                disabled={isLoading}
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <div className="input-wrapper">
              <span className="input-icon">🔒</span>
              <input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                className="auth-input"
                disabled={isLoading}
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="code">Server access code</label>
            <div className="input-wrapper">
              <span className="input-icon">🔑</span>
              <input
                id="code"
                type="text"
                placeholder="6-letter code"
                value={code}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setCode(e.target.value.toUpperCase())}
                className="auth-input"
                disabled={isLoading}
              />
            </div>
          </div>

          <button 
            type="submit" 
            className="auth-button"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <span className="spinner"></span>
                Signing in...
              </>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        <div className="auth-footer">
          <p>Don't have an account? <Link to="/register" className="auth-link">Create one</Link></p>
        </div>
      </div>
    </div>
  )
}
