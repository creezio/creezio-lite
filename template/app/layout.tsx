import type { Metadata } from 'next';
import brand from '@/brand.json';
import './globals.css';
export const metadata: Metadata = {title:brand.name,description:brand.description,referrer:'no-referrer',icons:{icon:'/favicon.svg',shortcut:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="fr"><body>{children}</body></html>;}
