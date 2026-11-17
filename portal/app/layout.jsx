import './globals.css';
import './portal.css';
import './brand-theme.css';
import './live.css';
export const metadata = {title:'Safcodes · Client Portal',description:'Your products, services and business, connected.',robots:{index:false,follow:false},icons:{icon:'/brand/safcodes-logo-square.png'}};
export default function RootLayout({children}){return <html lang="en"><body>{children}</body></html>}
