"use client";

import Link from "next/link";
import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";

export function HeaderAuthControls() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      <Show when="signed-out">
        <SignInButton mode="redirect">
          <button
            style={{
              borderRadius: 999,
              border: "1px solid rgba(73, 63, 46, 0.18)",
              background: "#fffdf8",
              color: "#2d251a",
              padding: "10px 14px",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Sign in
          </button>
        </SignInButton>
        <SignUpButton mode="redirect">
          <button
            style={{
              borderRadius: 999,
              border: "1px solid #0f766e",
              background: "#0f766e",
              color: "#f8fffe",
              padding: "10px 14px",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Create workspace
          </button>
        </SignUpButton>
      </Show>
      <Show when="signed-in">
        <Link
          href="/onboarding"
          style={{
            borderRadius: 999,
            border: "1px solid rgba(73, 63, 46, 0.18)",
            background: "#fffdf8",
            color: "#2d251a",
            padding: "10px 14px",
            fontSize: 14,
            cursor: "pointer",
            textDecoration: "none",
          }}
        >
          Workspace
        </Link>
        <UserButton />
      </Show>
    </div>
  );
}
