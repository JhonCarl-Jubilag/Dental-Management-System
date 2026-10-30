// The caller must first be verified using auth.getUser, not decoded JWT claims.
export async function requireClinicAccount(client, user, RequestError) {
  if (!user?.id || !user.email_confirmed_at) throw new RequestError('Please log in again.', 401);
  if (user.app_metadata?.clinic_provider_login_retired === true) throw new RequestError('This former dentist login has been retired.', 403);
  if (user.banned_until && (!Number.isFinite(Date.parse(user.banned_until)) || Date.parse(user.banned_until) > Date.now())) {
    throw new RequestError('This login account is disabled. Contact the Owner.', 403);
  }
  const { data: account, error } = await client.from('admin')
    .select('admin_id, auth_user_id, role, status').eq('auth_user_id', user.id).maybeSingle();
  if (error) throw new RequestError('Could not verify clinic access.', 500);
  if (!account || account.status !== 'active' || !['super_admin', 'admin'].includes(account.role)) {
    throw new RequestError('Only active clinic administrators can perform this action.', 403);
  }
  const { data: patient, error: patientError } = await client.from('patients')
    .select('patient_id').eq('auth_user_id', user.id).maybeSingle();
  if (patientError) throw new RequestError('Could not verify clinic access.', 500);
  if (patient) throw new RequestError('This login has conflicting account profiles. Contact the Owner.', 403);
  return { ...account, isOwner: account.role === 'super_admin' };
}
