import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './ClinicMap.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const ClinicMap = () => {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);

  const clinicLocation = {
    lat: 14.422362871132027,
    lng: 120.94216321698855,
    address: 'Tanzang Luma 2, Imus City, Cavite'
  };

  useEffect(() => {
    // Initialize map only once
    if (!mapInstanceRef.current && mapRef.current) {
      // Create map
      mapInstanceRef.current = L.map(mapRef.current).setView(
        [clinicLocation.lat, clinicLocation.lng], 
        16
      );

      // Add OpenStreetMap tiles
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(mapInstanceRef.current);

      const clinicIcon = L.divIcon({
        className: 'clinic-marker',
        html: `
          <div class="marker-pin">
            <i class="fas fa-tooth"></i>
          </div>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 40],
        popupAnchor: [0, -40]
      });

      // Add marker
      markerRef.current = L.marker(
        [clinicLocation.lat, clinicLocation.lng], 
        { icon: clinicIcon }
      ).addTo(mapInstanceRef.current);

      // Add popup
      markerRef.current.bindPopup(`
        <div class="map-popup">
          <h3>Fifthcusp Dental Clinic</h3>
          <p><i class="fas fa-map-marker-alt"></i> ${clinicLocation.address}</p>
          <p><i class="fas fa-phone"></i> (02) 1234-5678</p>
          <p><i class="fas fa-clock"></i> Mon-Fri: 8AM-6PM, Sat: 9AM-2PM</p>
          <a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(clinicLocation.address)}" 
             target="_blank" 
             rel="noopener noreferrer"
             class="map-directions-btn">
            <i class="fas fa-directions"></i> Get Directions
          </a>
        </div>
      `);

      markerRef.current.openPopup();
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [clinicLocation.lat, clinicLocation.lng, clinicLocation.address]);

  return (
    <div className="clinic-map-container">
      <div ref={mapRef} className="clinic-map" />
    </div>
  );
};

export default ClinicMap;