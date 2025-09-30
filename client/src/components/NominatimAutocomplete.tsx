import React, { useEffect, useRef, useState } from 'react'
import { useNotifications } from '../notifications'

function debounce(fn: Function, wait = 250) {
  let t: any
  return (...args: any[]) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), wait)
  }
}

export default function NominatimAutocomplete({ onSelect, value, onChange }: any){
  const [q, setQ] = useState(value || '')
  const [results, setResults] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const containerRef = useRef<HTMLDivElement|null>(null)
  const { push } = useNotifications()

  useEffect(()=>{ setActive(0); }, [results])

  const doSearch = debounce(async (v: string) => {
    if (!v || v.length < 3) { setResults([]); return }
    let usedProxy = false
    setLoading(true)
    try {
      const lang = navigator.language || navigator.languages?.[0] || ''
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(v)}`, { headers: lang ? { 'Accept-Language': lang } : undefined })
      if (res.ok) {
        const json = await res.json()
        if (json && json.length) { setResults(json); usedProxy = true; setLoading(false); return }
      }
    } catch (e) {
      // ignore and try public endpoint
    }

    // Fallback: directly call public Nominatim (client-side). For production prefer server proxy & caching.
      if ((import.meta as any).env?.VITE_DISABLE_CLIENT_GEOCODE_FALLBACK) {
      // If proxy unavailable and client fallback disabled, just return empty results silently
      setResults([])
      setLoading(false)
      return
    }
    try {
      const lang = navigator.language || navigator.languages?.[0] || ''
      const res2 = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(v)}&limit=8&addressdetails=1`, { headers: lang ? { 'Accept-Language': lang } : undefined })
      if (!res2.ok) { setResults([]); setLoading(false); return }
      const json2 = await res2.json()
  setResults(json2 || [])
    } catch (e) {
      // If public upstream fails and we're in dev, provide a deterministic dev stub so the UI remains testable
      const devStub = (import.meta as any).env?.VITE_ENABLE_DEV_GEOCODE_STUB || (import.meta as any).env?.DEV
      if (devStub) {
        const fake = [{ place_id: 'dev-1', display_name: v + ' (dev stub)', lat: '48.8566', lon: '2.3522' }]
        setResults(fake)
        setLoading(false)
        return
      }
      setResults([])
    }
    setLoading(false)
  }, 250)

  // keep internal q in sync with controlled value when provided
  useEffect(()=>{
    if (typeof value === 'string' && value !== q) setQ(value)
  }, [value])

  function onChangeLocal(v: string){
    setQ(v)
    if (onChange) onChange(v)
    doSearch(v)
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>){
    if (!results.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a+1, results.length-1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a-1, 0)) }
    if (e.key === 'Enter') { e.preventDefault(); const r = results[active]; if (r) { choose(r) } }
  }

  function choose(r: any){
    setQ(r.display_name)
    setResults([])
    if (onSelect) onSelect(r)
  }

  // click outside to close
  useEffect(()=>{
    function onDoc(e: any){ if (containerRef.current && !containerRef.current.contains(e.target)) setResults([]) }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [])

  return (
    <div style={{position:'relative'}} ref={containerRef}>
      <input value={q} onChange={(e:any)=> onChangeLocal(e.target.value)} onKeyDown={onKey} placeholder="Search address (OSM)" />
      {loading && <div style={{position:'absolute', right:8, top:8, fontSize:12, color:'#666'}}>Loading…</div>}
      {results.length > 0 && (
        <div style={{position:'absolute', background:'#fff', border:'1px solid #eee', zIndex:500, width: '100%', maxHeight: 240, overflow: 'auto'}}>
          {results.map((r, idx) => (
            <div key={r.place_id || idx} style={{padding:8, cursor:'pointer', background: idx === active ? '#f2f6ff' : 'transparent'}} onMouseEnter={()=>setActive(idx)} onClick={()=> choose(r) }>
              <div style={{fontWeight:600}}>{r.display_name}</div>
              {r.address && (
                <div style={{fontSize:12, color:'#666'}}>{[r.address.house_number, r.address.road, r.address.city, r.address.country].filter(Boolean).join(' · ')}</div>
              )}
            </div>
          ))}
          {results.length === 0 && !loading && <div style={{padding:8, color:'#666'}}>No results</div>}
        </div>
      )}
    </div>
  )
}
