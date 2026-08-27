import { redirect } from 'next/navigation';

export default function TwoFAVerifyPage({ searchParams }) {
  const authServerUrl = process.env.NEXT_PUBLIC_AUTH_SERVER_URL || 'http://localhost:8000';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams || {})) {
    sp.set(k, String(v));
  }
  redirect(`${authServerUrl}/2fa-verify-page?${sp.toString()}`);
}
