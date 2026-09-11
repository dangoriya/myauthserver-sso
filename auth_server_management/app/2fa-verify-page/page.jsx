import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function TwoFAVerifyPage({ searchParams }) {
  const authServerUrl = (
    process.env.AUTH_SERVER_URL ||
    process.env.NEXT_PUBLIC_AUTH_SERVER_URL ||
    'https://auth.example.com'
  ).replace(/\/+$/, '');

  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams || {})) {
    sp.set(k, String(v));
  }
  redirect(`${authServerUrl}/2fa-verify-page?${sp.toString()}`);
}
