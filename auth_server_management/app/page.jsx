import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'IAM — Redirecting to Sign In',
};

// The auth_server serves the login page. This page dynamically redirects
// visitors to the auth_server's /authorize endpoint at runtime using the
// AUTH_SERVER_URL and MANAGEMENT_URL configured in the environment.
export default function HomePage() {
  const authServerUrl = (
    process.env.AUTH_SERVER_URL ||
    process.env.NEXT_PUBLIC_AUTH_SERVER_URL ||
    'https://auth.example.com'
  ).replace(/\/+$/, '');

  const managementUrl = (
    process.env.MANAGEMENT_URL ||
    process.env.NEXT_PUBLIC_MANAGEMENT_URL ||
    (typeof window !== 'undefined' ? window.location.origin : 'https://iam.example.com')
  ).replace(/\/+$/, '');

  const redirectUri = `${managementUrl}/auth/callback`;
  const target = `${authServerUrl}/authorize?client_id=auth_management_app&redirect_uri=${encodeURIComponent(redirectUri)}`;
  redirect(target);
}
