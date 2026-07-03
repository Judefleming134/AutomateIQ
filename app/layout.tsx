import type { Metadata } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const ICON =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCA2NCA2NCc+PHJlY3Qgd2lkdGg9JzY0JyBoZWlnaHQ9JzY0JyByeD0nMTQnIGZpbGw9JyMwYjBmMTcnLz48ZyB0cmFuc2Zvcm09J3RyYW5zbGF0ZSg4LDgpIHNjYWxlKDIpJyBmaWxsPScjM2I4YmZmJz48cGF0aCBmaWxsLXJ1bGU9J2V2ZW5vZGQnIGQ9J00xOS40MyAxMi45OGMuMDQtLjMyLjA3LS42NS4wNy0uOThzLS4wMy0uNjYtLjA3LS45OGwyLjExLTEuNjVhLjUuNSAwIDAgMCAuMTItLjY0bC0yLTMuNDZhLjUuNSAwIDAgMC0uNjEtLjIybC0yLjQ5IDFhNy4zIDcuMyAwIDAgMC0xLjY5LS45OGwtLjM4LTIuNjVBLjQ5LjQ5IDAgMCAwIDE0IDJoLTRhLjQ5LjQ5IDAgMCAwLS40OS40MmwtLjM4IDIuNjVjLS42MS4yNS0xLjE3LjU5LTEuNjkuOThsLTIuNDktMWEuNS41IDAgMCAwLS42MS4yMmwtMiAzLjQ2YS41LjUgMCAwIDAgLjEyLjY0TDQuNTcgMTFjLS4wNC4zMi0uMDcuNjUtLjA3Ljk4cy4wMy42Ni4wNy45OGwtMi4xMSAxLjY1YS41LjUgMCAwIDAtLjEyLjY0bDIgMy40NmMuMTQuMjQuNDMuMzQuNjkuMjJsMi40OS0xYy41Mi4zOSAxLjA4LjczIDEuNjkuOThsLjM4IDIuNjVjLjA0LjI0LjI1LjQyLjQ5LjQyaDRjLjI0IDAgLjQ1LS4xOC40OS0uNDJsLjM4LTIuNjVjLjYxLS4yNSAxLjE3LS41OSAxLjY5LS45OGwyLjQ5IDFjLjI2LjEyLjU1LjAyLjY5LS4yMmwyLTMuNDZhLjUuNSAwIDAgMC0uMTItLjY0bC0yLjExLTEuNjV6TTEyIDE1LjVBMy41IDMuNSAwIDEgMSAxMiA4LjVhMy41IDMuNSAwIDAgMSAwIDd6Jy8+PC9nPjwvc3ZnPg==";

export const metadata: Metadata = {
  title: "AutomateIQ Platform",
  icons: { icon: ICON },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
