import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { NotificationsProvider } from './notifications'
import { AuthProvider } from './auth'
import DragDropHandler from './DragDropHandler'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <NotificationsProvider>
          <App />
          <DragDropHandler />
        </NotificationsProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
