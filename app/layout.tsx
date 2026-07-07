import type { Metadata } from 'next'
// @ts-ignore
import './globals.css' // Global styles

export const metadata: Metadata = {
  title: 'Battleship Solver',
  description:
    'A custom battleship probability calculator and solver. Input your board size, boats, and clues to find the best next shot.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  )
}
