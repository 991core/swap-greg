import type { Metadata } from "next";
import { Providers } from "./providers";
import { I18nProvider } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hermes — HMS Protocol",
  description: "Find tokens by name or address and compare LI.FI, Rango and 1Click routes with transparent fees.",
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
