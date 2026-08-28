import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bridge Tournament",
  description: "Scoring for a three-team duplicate IMPs teams match",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
