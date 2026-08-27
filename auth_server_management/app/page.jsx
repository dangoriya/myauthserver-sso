import { redirect } from 'next/navigation';

export const metadata = {
  title: 'IAM — Redirecting to Sign In',
};

// The auth_server now serves the actual login page (Jinja2, with the same
// design as this Next.js portal). This page simply bounces visitors to the
// auth_server's /authorize endpoint so they sign in centrally. The auth_server
// will set the SSO session cookie and redirect back to the management dashboard.
export default function HomePage() {
  const authServerUrl = process.env.NEXT_PUBLIC_AUTH_SERVER_URL || 'http://localhost:8000';
  const redirectUri = `${process.env.NEXT_PUBLIC_AUTH_SERVER_URL?.replace(':8000', ':3005') || 'http://localhost:3005'}/auth/callback`;
  // Use client_id = auth_management_app which is pre-registered with the auth_server
  const target = `${authServerUrl}/authorize?client_id=auth_management_app&redirect_uri=${encodeURIComponent(redirectUri)}`;
  redirect(target);
}
