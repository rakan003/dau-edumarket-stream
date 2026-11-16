import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'Edu Maraket – Dar Al Uloom University',description:'Dar Al Uloom University course registration and secure checkout.',icons:{icon:'/assets/cropped-logo-02-1-1.png'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
