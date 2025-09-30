import fs from 'fs/promises'
import path from 'path'

const CACHE_PATH = path.join(new URL('.', import.meta.url).pathname, 'geocode_cache.json')
const MAX_ENTRIES = 2000

class GeocodeDiskCache {
  constructor(){
    this.map = new Map()
    this.loaded = false
    this.saving = false
    this.saveScheduled = false
  }

  async load(){
    if (this.loaded) return
    try {
      const raw = await fs.readFile(CACHE_PATH, 'utf8')
      const obj = JSON.parse(raw)
      for (const [k, v] of Object.entries(obj || {})) {
        this.map.set(k, v)
      }
    } catch (e) {
      // ignore missing/corrupt cache
    }
    this.loaded = true
  }

  scheduleSave(){
    if (this.saveScheduled) return
    this.saveScheduled = true
    setTimeout(()=> this.save().catch(()=>{}), 1000)
  }

  async save(){
    this.saveScheduled = false
    if (this.saving) return
    this.saving = true
    try {
      const obj = Object.fromEntries(this.map)
      await fs.writeFile(CACHE_PATH, JSON.stringify(obj), 'utf8')
    } catch (e) {
      // ignore
    }
    this.saving = false
  }

  get(key){
    const it = this.map.get(key)
    if (!it) return null
    // LRU: move to end
    this.map.delete(key)
    this.map.set(key, it)
    return it
  }

  set(key, data){
    this.map.delete(key)
    this.map.set(key, data)
    // enforce max size
    while (this.map.size > MAX_ENTRIES) {
      const first = this.map.keys().next().value
      this.map.delete(first)
    }
    this.scheduleSave()
  }
}

export const geocodeDiskCache = new GeocodeDiskCache()

// save on exit
process.on('exit', ()=>{ geocodeDiskCache.save().catch(()=>{}) })
process.on('SIGINT', ()=>{ geocodeDiskCache.save().catch(()=>{}); process.exit(0) })
