// Application roles come from protected database profiles, never user metadata.
export const isClinicUser = role => role === 'super_admin' || role === 'admin';
export const isOwner = role => role === 'super_admin';
export const roleLabel = role => role === 'super_admin' ? 'Super Admin / Owner' : role === 'admin' ? 'Admin / Staff' : role === 'patient' ? 'Patient' : 'Account';
export const roleDestinations = {
  super_admin: '/admin/dashboard',
  admin: '/admin/dashboard',
  patient: '/',
};
