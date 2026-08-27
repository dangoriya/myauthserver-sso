import { redirect } from 'next/navigation';

export const metadata = {
  title: 'Sign Up — IAM',
};

// Signup is now handled centrally by the auth_server. The new account flow:
//  1. User lands here → bounced to /signup on the auth_server
//  2. Auth_server runs the email-OTP → password → optional 2FA wizard
//  3. On success, auth_server establishes the SSO session and redirects to
//     /dashboard/profile?welcome=1 where the user can set / change password
//     and configure 2FA in the management UI.
export default function SignupPage() {
  const authServerUrl = process.env.NEXT_PUBLIC_AUTH_SERVER_URL || 'http://localhost:8000';
  redirect(`${authServerUrl}/signup`);
}
