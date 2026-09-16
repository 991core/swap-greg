import type { Metadata } from "next";
import { Providers } from "./providers";
import { I18nProvider } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hermes — HMS Protocol",
  description: "Swap and bridge cross-chain with transparent fees. Top 20 market cap.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <I18nProvider>
          <Providers>{children}</Providers>
        </I18nProvider>
      </body>
    </html>
  );
}
