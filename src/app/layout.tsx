import type { Metadata } from "next";
import { SiteHeader } from "./components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: "Warrant — buyer-side purchase authorization",
  description: "Human-confirmed purchase mandates for AI-proposed carts. PayPal Sandbox only.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col"><SiteHeader /><main className="page-shell">{children}</main><footer className="site-footer">Warrant · Sandbox demo · No real money · Human-present checkout only</footer></body>
    </html>
  );
}
