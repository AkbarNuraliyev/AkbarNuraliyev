import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n/client";
import { getLocale } from "@/lib/i18n/server";
import { Toaster } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: { default: "PoultryOS — poultry production & distribution platform", template: "%s · PoultryOS" },
  description: "Integrated farm-to-customer management for poultry farms, processing plants and distributors: receiving, MES yields, FEFO inventory, B2B orders, cold chain and batch traceability.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0b1a30" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale === "uz" ? "uz" : locale}>
      <body>
        <I18nProvider locale={locale}>
          {children}
          <Toaster />
        </I18nProvider>
      </body>
    </html>
  );
}
