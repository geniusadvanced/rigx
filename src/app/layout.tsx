import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RIGX Genius Dashboard',
  description: 'Repair Intelligence & Genius eXecution',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
