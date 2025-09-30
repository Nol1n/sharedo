import React, { useEffect, useRef, useState } from 'react'

export default function PlaceInput({ value, onChange, onSelect }: any){
  const ref = useRef<HTMLInputElement | null>(null)
  const apiKey = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY || null
  const [ready, setReady] = useState(false)

  useEffect(()=>{
    if (!apiKey) return setReady(false)
    if ((window as any).google && (window as any).google.maps && (window as any).google.maps.places) return setReady(true)
    const s = document.createElement('script')
    s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`
    s.async = true
    s.defer = true
    s.onload = ()=> setReady(true)
    document.body.appendChild(s)
  }, [])

  useEffect(()=>{
    if (!ready) return
    if (!ref.current) return
    try {
      const ac = new (window as any).google.maps.places.Autocomplete(ref.current, { types: ['geocode','establishment'] })
      ac.addListener('place_changed', ()=>{
        const place = ac.getPlace()
        if (onSelect) onSelect(place)
      })
      return ()=> (ac && ac.unbindAll && ac.unbindAll())
    } catch (e) { }
  }, [ready])

  return (
    <input ref={ref} value={value} onChange={(e:any)=> onChange(e.target.value)} placeholder={apiKey? 'Search address or place' : 'Place name'} />
  )
}
