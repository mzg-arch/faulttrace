import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FaultTrace",
  description: "Evidence-grounded troubleshooting for industrial maintenance teams.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
