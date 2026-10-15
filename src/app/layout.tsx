import type { Metadata, Viewport } from 'next';
import '@fontsource/atkinson-hyperlegible/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-700.css';
import '@fontsource-variable/lexend/index.css';
import './globals.css';
import { ServiceWorker } from '@/components/ServiceWorker';

export const metadata: Metadata = {
  title: { default: 'CARS Rehab', template: '%s · CARS Rehab' },
  description: 'Reaching, maths and colour games for stroke rehabilitation, with a research-ready data sheet.',
  applicationName: 'CARS Rehab',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'CARS Rehab', statusBarStyle: 'black-translucent' },
  icons: { icon: [{ url: '/icon.svg', type: 'image/svg+xml' }], apple: '/apple-touch-icon.png' },
  robots: { index: false, follow: false }
};

export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover',
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#EDF2EF' }, { media: '(prefers-color-scheme: dark)', color: '#0C1412' }]
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
