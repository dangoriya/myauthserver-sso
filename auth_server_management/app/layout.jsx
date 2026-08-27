import './globals.css'

export const metadata = {
  title: 'Central Auth Server - Management Dashboard',
  description: 'Manage users, registered client applications, and Google SSO settings.',
}

// Every page in this portal reads from localStorage / cookies / query
// params (it's a client-side SPA behind an auth wall). Force dynamic
// rendering so Next.js never tries to pre-render at build time — that
// avoids "useSearchParams must be wrapped in a Suspense boundary"
// errors on /auth/callback.
export const dynamic = 'force-dynamic'

export default function RootLayout({
  children,
}) {
  return (
    <html lang="en">
      <body class="min-h-screen bg-slate-950 text-slate-100 selection:bg-emerald-500 selection:text-white">
        {children}
      </body>
    </html>
  )
}
