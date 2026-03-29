import { SignIn } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

const wrapperStyle: Record<string, string | number> = {
  minHeight: "calc(100vh - 73px)",
  background:
    "radial-gradient(circle at top left, rgba(196,143,44,0.22), transparent 30%), linear-gradient(180deg, #f7f1e4 0%, #fffdfa 48%, #f5efe5 100%)",
  padding: "56px 20px 80px",
  color: "#1f2933",
};

const cardStyle: Record<string, string | number> = {
  border: "1px solid rgba(73, 63, 46, 0.18)",
  borderRadius: 24,
  padding: 28,
  background: "rgba(255,255,255,0.82)",
  boxShadow: "0 20px 50px rgba(58, 43, 25, 0.08)",
  backdropFilter: "blur(8px)",
  maxWidth: 520,
  margin: "0 auto",
};

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const { userId } = await auth();
  if (userId) {
    redirect("/onboarding");
  }

  const afterSignInUrl = process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL ?? "/onboarding";
  const signUpUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL ?? "/sign-up";

  return (
    <main style={wrapperStyle}>
      <section style={cardStyle}>
        <p
          style={{
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#916b22",
            fontSize: 12,
            margin: 0,
          }}
        >
          Sign In
        </p>
        <h1
          style={{
            fontFamily:
              '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
            fontSize: "clamp(2rem, 4vw, 3rem)",
            lineHeight: 1.05,
            margin: "14px 0 12px",
          }}
        >
          Pick up where your grant work left off
        </h1>
        <p style={{ color: "#5e5241", lineHeight: 1.7, marginTop: 0 }}>
          Sign in to your Grant Guardian workspace and keep your Notion operating record, grant
          pipeline, and submission work in sync.
        </p>

        <div style={{ marginTop: 20, display: "flex", justifyContent: "center" }}>
          <SignIn
            routing="path"
            path="/sign-in"
            forceRedirectUrl={afterSignInUrl}
            fallbackRedirectUrl={afterSignInUrl}
            signUpForceRedirectUrl={signUpUrl}
            signUpFallbackRedirectUrl={signUpUrl}
            appearance={{
              variables: {
                colorPrimary: "#0f766e",
                colorBackground: "#fffdf8",
                colorText: "#1f2933",
                colorInputText: "#1f2933",
                colorInputBackground: "#fffdfa",
                colorInputBorder: "rgba(107, 93, 70, 0.22)",
                borderRadius: "16px",
              },
              elements: {
                card: {
                  boxShadow: "none",
                  border: "0",
                  background: "transparent",
                },
                rootBox: {
                  width: "100%",
                },
                headerTitle: {
                  display: "none",
                },
                headerSubtitle: {
                  display: "none",
                },
              },
            }}
          />
        </div>
      </section>
    </main>
  );
}
