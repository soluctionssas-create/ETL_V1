import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ETL Contable SaaS",
  description: "Panel administrativo para clasificacion contable con IA",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
