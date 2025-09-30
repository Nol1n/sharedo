import React, { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useNotifications } from './notifications'
import { useAuth } from './auth'

export default function DragDropHandler(){
  const loc = useLocation()
  const notif = useNotifications()
  const { refreshProfile } = useAuth()

  useEffect(()=>{
    const onDragOver = (e: any) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }
    const onDrop = async (e: any) => {
      e.preventDefault()
      const files: File[] = Array.from(e.dataTransfer.files || [])
      if (!files.length) return
      const img = files.find(f => f.type.startsWith('image/'))
      if (!img) { notif.push({ id: String(Date.now()), type: 'info', title: 'No image', body: 'Only image files are supported' }); return }

      try {
        const form = new FormData()
        form.append('file', img)
        const up = await fetch('/api/upload', { method: 'POST', credentials: 'include', body: form })
        if (!up.ok) throw new Error('Upload failed')
        const data = await up.json()
        const url = data.url

        // Heuristics: profile, moodboard, chat
        if (loc.pathname.startsWith('/profile')) {
          // Update avatar directly
          await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type':'application/json' }, credentials: 'include', body: JSON.stringify({ avatarUrl: url }) })
          await refreshProfile()
          notif.push({ id: String(Date.now()), type: 'success', title: 'Avatar updated', body: 'Your avatar was updated from the dropped image' })
          return
        }

        if (loc.pathname.startsWith('/moodboard')) {
          // dispatch event so Moodboard can open modal with prefilled image URL
          window.dispatchEvent(new CustomEvent('sharedo:dropped', { detail: { kind: 'idea', url } }))
          notif.push({ id: String(Date.now()), type: 'success', title: 'Image uploaded', body: 'Drop detected — open Moodboard to finish adding the idea' })
          return
        }

        // If a room manage modal is open, dispatch a room drop event so the chat page can assign the icon
        try {
          const modal = document.querySelector('.discord-modal')
          if (modal && getComputedStyle(modal).display !== 'none') {
            window.dispatchEvent(new CustomEvent('sharedo:dropped', { detail: { kind: 'room', url } }))
            notif.push({ id: String(Date.now()), type: 'success', title: 'Room icon uploaded', body: 'Drop detected — applied to open room settings' })
            return
          }
        } catch (e) {}

        // Default: copy URL to clipboard and notify user
        try { await navigator.clipboard.writeText(url) } catch {}
        notif.push({ id: String(Date.now()), type: 'success', title: 'Image uploaded', body: 'Image uploaded. URL copied to clipboard.' })
      } catch (err:any) {
        console.error('DnD upload error', err)
        notif.push({ id: String(Date.now()), type: 'error', title: 'Upload failed', body: err.message || 'Upload failed' })
      }
    }

    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return ()=>{ window.removeEventListener('dragover', onDragOver); window.removeEventListener('drop', onDrop) }
  }, [loc.pathname, notif, refreshProfile])

  return null
}
