import type { Metadata } from "next";

export const metadata: Metadata = {
  metadataBase: new URL("https://rate-history.vercel.app"),
  title: "USDT Signal",
  description: "USDT / KRW and K-premium signals and simulation.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
