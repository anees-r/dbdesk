import "./globals.css";

export const metadata = { title: "dbdesk", description: "Private Postgres client" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
