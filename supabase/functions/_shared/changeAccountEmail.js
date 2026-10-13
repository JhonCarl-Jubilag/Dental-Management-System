const emailPattern = (email) => email.replace(/[\\%_]/g, '\\$&');
const normalizeEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';

// Auth and profile writes use separate APIs. Verify both records and compensate
// for a failed profile write instead of leaving an account with two emails.
export async function changeAccountEmail(client, { table, idField, id, newEmail, expectedEmail }, RequestError) {
  if ((typeof id !== 'number' && (typeof id !== 'string' || !/^\d+$/.test(id))) ||
    !Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw new RequestError('Select a valid account.');
  id = Number(id);
  const email = normalizeEmail(newEmail);
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new RequestError('Enter a valid email address.');
  }
  if (!normalizeEmail(expectedEmail)) throw new RequestError('Reload the profile before changing its email.');
  const { data: profile, error: profileError } = await client.from(table)
    .select(`${idField}, email`).eq(idField, id).maybeSingle();
  if (profileError) throw new RequestError('Could not read the account profile.', 500);
  if (!profile) throw new RequestError('The account profile was not found.', 404);
  const oldEmail = profile.email;
  if (oldEmail !== expectedEmail) throw new RequestError('The email has changed. Reload the profile and try again.', 409);
  const oldNormalized = normalizeEmail(oldEmail);
  const reservedEmail = 'jhoncarl.jubilag@cvsu.edu.ph';
  if (email === reservedEmail || oldNormalized === reservedEmail) {
    throw new RequestError('The super admin email cannot be assigned to a doctor or patient.', 409);
  }

  // Reject both new-email collisions and ambiguous existing role assignments.
  for (const [profileTable, key] of [['patients', 'patient_id'], ['doctors', 'doctor_id'], ['admin', 'admin_id']]) {
    for (const address of new Set([oldNormalized, email])) {
      const { data, error } = await client.from(profileTable)
        .select(`${key}, email`).ilike('email', emailPattern(address)).limit(2);
      if (error) throw new RequestError('Could not check for existing accounts.', 500);
      if (data?.some(row => profileTable !== table || Number(row[key]) !== id)) {
        throw new RequestError(address === oldNormalized
          ? 'This profile shares its email with another profile. Resolve that account conflict first.'
          : 'This email is already assigned to a profile. Use a different email.', 409);
      }
    }
  }

  let account;
  const newEmailAccounts = [];
  for (let page = 1; ; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
    if (error || !Array.isArray(data?.users)) throw new RequestError('Could not verify the login account.', 500);
    for (const user of data.users) {
      const userEmail = normalizeEmail(user.email);
      if (userEmail === oldNormalized) {
        if (account) throw new RequestError('The login email matches multiple accounts. Resolve that conflict first.', 409);
        account = user;
      }
      if (userEmail === email) newEmailAccounts.push(user);
    }
    if (data.users.length < 100) break;
  }
  if (!account) throw new RequestError('This profile has no matching login account. A login account must be provisioned first.', 409);
  if (newEmailAccounts.some(user => user.id !== account.id)) {
    throw new RequestError('This email already belongs to a login account. Use a different email.', 409);
  }
  const result = () => ({ success: true, email, message: 'Profile and login email updated successfully. Use the new email with the existing password.' });
  if (oldEmail === email && account.email === email) return result();

  const readState = async () => {
    const { data: authData, error: authError } = await client.auth.admin.getUserById(account.id);
    const { data: currentProfile, error } = await client.from(table)
      .select(`${idField}, email`).eq(idField, id).maybeSingle();
    if (authError || error || !authData?.user?.email || !currentProfile?.email) {
      throw new Error('Could not verify both account records.');
    }
    return { auth: authData.user, profile: currentProfile };
  };
  const matches = (state) => normalizeEmail(state.auth.email) === normalizeEmail(state.profile.email);
  let writeStarted = false;
  try {
    // Check again after validation to catch edits made while the form was open.
    const current = await readState();
    if (current.profile.email !== oldEmail || normalizeEmail(current.auth.email) !== oldNormalized) {
      throw new RequestError('The account has changed. Reload the profile and try again.', 409);
    }
    writeStarted = true;
    const { data: updatedAuth, error: authError } = await client.auth.admin.updateUserById(account.id, { email });
    if (authError) throw new RequestError(authError.message || 'Could not change the login email.');
    if (normalizeEmail(updatedAuth?.user?.email) !== email) throw new Error('The login email was not updated.');
    const { data: updatedProfile, error } = await client.from(table).update({ email })
      .eq(idField, id).eq('email', oldEmail).select(`${idField}, email`).maybeSingle();
    if (error || updatedProfile?.email !== email) throw new Error('Could not update the profile email.');
    const finalState = await readState();
    if (!matches(finalState) || finalState.profile.email !== email) throw new Error('The account changed while saving.');
    return result();
  } catch (error) {
    if (!writeStarted) throw error;
    try {
      let state = await readState();
      // A network error can arrive after a successful write. Check its result.
      if (matches(state)) {
        if (state.profile.email === email) return result();
        throw new RequestError(error instanceof RequestError ? error.message : 'Email change failed. Both account records still match. Please try again.', error instanceof RequestError ? error.status : 409);
      }
      if (normalizeEmail(state.auth.email) === email) {
        // Restore Auth to the latest profile email; never overwrite a newer
        // profile edit or delete/recreate an existing account during recovery.
        const { error: rollbackError } = await client.auth.admin.updateUserById(account.id, { email: state.profile.email });
        if (rollbackError) throw new Error('Could not restore the login email.');
      } else if (state.profile.email === email && normalizeEmail(state.auth.email) === oldNormalized) {
        const { data, error: rollbackError } = await client.from(table).update({ email: oldEmail })
          .eq(idField, id).eq('email', email).select(`${idField}, email`).maybeSingle();
        if (rollbackError || data?.email !== oldEmail) throw new Error('Could not restore the profile email.');
      } else {
        throw new Error('Concurrent account changes require administrator attention.');
      }
      state = await readState();
      if (!matches(state)) throw new Error('Account recovery did not finish.');
    } catch (recoveryError) {
      if (recoveryError instanceof RequestError) throw recoveryError;
      console.error('Account email recovery needs administrator attention.', table, id, account.id);
      throw new RequestError('Email change could not be completed or fully restored. Check the profile and Supabase login email before retrying.', 500);
    }
    throw new RequestError('Email change failed. The account emails were restored to match. Reload the profile and try again.', 409);
  }
}
