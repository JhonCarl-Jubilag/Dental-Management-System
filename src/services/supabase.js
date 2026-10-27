import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY;

// Capture callback intent before Auth consumes and clears the URL fragment.
const callbackUrl = new URL(window.location.href);
const callbackHash = new URLSearchParams(callbackUrl.hash.slice(1));
const callbackType = callbackHash.get('type') || callbackUrl.searchParams.get('type');
export const emailConfirmationCallback = {
  received: callbackType === 'signup' || callbackType === 'email_verification' ||
    (callbackUrl.pathname === '/verify-email' && callbackUrl.searchParams.has('code')),
  error: callbackHash.get('error_description') || callbackUrl.searchParams.get('error_description'),
};

if (emailConfirmationCallback.received && callbackUrl.pathname !== '/verify-email') {
  // Also handle confirmation links redirected to the configured Site URL.
  window.history.replaceState(window.history.state, '', `/verify-email${callbackUrl.search}${callbackUrl.hash}`);
}

export const supabase = createClient(supabaseUrl, supabaseKey);

// Explicit provider fields for browser queries; legacy credentials are excluded.
export const doctorProfileFields = 'doctor_id, first_name, last_name, email, specialization, contact_no, date_created, status, availability';
