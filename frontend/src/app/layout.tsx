import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Building Marathon | Run From Anywhere', description: 'Choose your distance. Run anywhere. Earn your finisher kit.' };
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="en"><body>{children}</body></html>;
}
