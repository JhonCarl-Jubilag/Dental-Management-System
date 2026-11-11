// Shared clinic contact and location details.
export const CLINIC_NAME = 'Diolata Dental Clinic';
export const CLINIC_ADDRESS = '150 Sara St., Sarah Subd. Bayan Luma 3 Imus City, Cavite';
export const CLINIC_PHONE = '0930 482 0352';
export const CLINIC_EMAIL = 'diolatadental.clinic@yahoo.com.ph';
export const CLINIC_LANDLINE = '046-4723054';
export const CLINIC_HOURS = 'Monday–Saturday, 9 AM–6 PM. Closed on Sundays.';
export const CLINIC_LOCATION = { lat: 14.419364603769948, lng: 120.9369070449141 };
export const CLINIC_DIRECTIONS_URL = 'https://www.google.com/maps/dir/?api=1&destination=' +
  encodeURIComponent(CLINIC_LOCATION.lat + ',' + CLINIC_LOCATION.lng);
