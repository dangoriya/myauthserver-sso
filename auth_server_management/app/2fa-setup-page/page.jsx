import { redirect } from 'next/navigation';

export default function TwoFASetupPage({ searchParams }) {
  // 2FA setup is now served by the auth_server itself. Forward any query
  // string (user_id, client_id, redirect_uri, state) verbatim.
  const authServerUrl = process.env.NEXT_PUBLIC_AUTH_SERVER_URL || 'http://localhost:8000';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams || {})) {
    sp.set(k, String(v));
  }
  redirect(`${authServerUrl}/2fa-setup-page?${sp.toString()}`);
}
