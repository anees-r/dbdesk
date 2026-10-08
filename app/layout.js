import "./globals.css";
import { ConfirmProvider } from "./ui";

export const metadata = { title: "dbdesk", description: "Private Postgres client" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <ConfirmProvider>{children}</ConfirmProvider>
      </body>
    </html>
  );
}
