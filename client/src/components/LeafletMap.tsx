import React from 'react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix default icon paths for Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.3/dist/images/marker-shadow.png'
})

export default function LeafletMap({ events, center = [48.8566, 2.3522], zoom = 5 }: any){
  return (
    <MapContainer center={center as any} zoom={zoom} style={{ height: '600px', width: '100%' }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
      />
      {events.filter((e:any)=> e.place_lat && e.place_lng).map((e:any) => (
        <Marker key={e.id} position={[Number(e.place_lat), Number(e.place_lng)]}>
          <Popup>
            <strong>{e.title}</strong>
            <div>{e.location || ''}</div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}
