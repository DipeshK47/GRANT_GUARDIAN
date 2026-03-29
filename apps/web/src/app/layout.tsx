import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ClerkProvider } from "@clerk/nextjs";
import { HeaderAuthControls } from "./header-auth-controls";

export const metadata: Metadata = {
  title: "Grant Guardian",
  description: "Notion-native grant intelligence and workflow operating system.",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const clerkSignInUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "/sign-in";
  const clerkSignUpUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL ?? "/sign-up";
  const clerkAfterSignInUrl =
    process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL ?? "/onboarding";
  const clerkAfterSignUpUrl =
    process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL ?? "/onboarding";

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            '"Source Sans 3", "Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif',
          background: "#f7f1e4",
          color: "#1f2933",
        }}
      >
        <ClerkProvider
          publishableKey={clerkPublishableKey}
          signInUrl={clerkSignInUrl}
          signUpUrl={clerkSignUpUrl}
          signInForceRedirectUrl={clerkAfterSignInUrl}
          signUpForceRedirectUrl={clerkAfterSignUpUrl}
          signInFallbackRedirectUrl={clerkAfterSignInUrl}
          signUpFallbackRedirectUrl={clerkAfterSignUpUrl}
        >
          <header
            style={{
              position: "sticky",
              top: 0,
              zIndex: 20,
              backdropFilter: "blur(14px)",
              background: "rgba(247, 241, 228, 0.9)",
              borderBottom: "1px solid rgba(73, 63, 46, 0.12)",
            }}
          >
            <div
              style={{
                maxWidth: 1180,
                margin: "0 auto",
                padding: "14px 20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
              }}
            >
              <Link
                href="/"
                style={{
                  color: "#1f2933",
                  textDecoration: "none",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                <span
                  style={{
                    fontFamily:
                      '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
                    fontSize: "1.2rem",
                  }}
                >
                  Grant Guardian
                </span>
                <span
                  style={{
                    fontSize: 13,
                    color: "#5e5241",
                  }}
                >
                  Notion-native grant operations for lean teams
                </span>
              </Link>

              <HeaderAuthControls />
            </div>
          </header>
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
