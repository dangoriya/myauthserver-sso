import './globals.css'

export const metadata = {
  title: 'Central Auth Server - Management Dashboard',
  description: 'Manage users, registered client applications, and Google SSO settings.',
}

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
