import './globals.css'; 
import { Inter } from 'next/font/google';
import { AuthProvider } from './auth/useAuth';   // ✅ Tambah import AuthProvider

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: 'RigX.my',
  description: "Malaysia's Premier PC Hardware Marketplace",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {/* ✅ Balut semua content dengan AuthProvider */}
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
