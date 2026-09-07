import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Sign Up — IAM',
};

// Signup is handled centrally by the auth_server.
// This page dynamically redirects to /signup on the configured AUTH_SERVER_URL.
export default function SignupPage() {
  const authServerUrl = (
    process.env.AUTH_SERVER_URL ||
    process.env.NEXT_PUBLIC_AUTH_SERVER_URL ||
    'https://auth.example.com'
  ).replace(/\/+$/, '');

  redirect(`${authServerUrl}/signup`);
}
