import React from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix default icon paths for Leaflet (use CDN assets)
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.3/dist/images/marker-shadow.png'
})

function ClickHandler({ onMapClick }: any) {
  useMapEvents({
    click(e) {
      if (onMapClick) onMapClick(e.latlng.lat, e.latlng.lng)
    }
  })
  return null
}

export default function MapPreview({ lat, lng, title, location, onMapClick }: any){
  const hasCoords = lat !== undefined && lat !== null && lng !== undefined && lng !== null
  const center = hasCoords ? [Number(lat), Number(lng)] as any : [48.8566, 2.3522]
  return (
    <div style={{marginTop:12}}>
      <div style={{height:200, width:'100%', borderRadius:8, overflow:'hidden', border:'1px solid var(--border)'}}>
        <MapContainer center={center} zoom={hasCoords ? 13 : 5} style={{height:'100%', width:'100%'}}>
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
          />
          <ClickHandler onMapClick={onMapClick} />
          {hasCoords && (
            <Marker position={[Number(lat), Number(lng)]}>
              <Popup>
                <strong>{title}</strong>
                <div>{location || ''}</div>
              </Popup>
            </Marker>
          )}
        </MapContainer>
      </div>
      <div style={{fontSize:12, color:'#666', marginTop:6}}>{hasCoords ? 'Click the marker to see details.' : 'Click on the map to set the event location.'}</div>
    </div>
  )
}
