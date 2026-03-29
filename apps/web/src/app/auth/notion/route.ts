import { auth } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

const appBaseUrl =
  process.env.NEXT_PUBLIC_APP_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:4000";

const buildBackendUrl = (request: NextRequest) => {
  const incomingUrl = new URL(request.url);
  const targetUrl = new URL("/auth/notion", appBaseUrl);

  incomingUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.append(key, value);
  });

  return targetUrl;
};

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  const response = await fetch(buildBackendUrl(request), {
    method: "GET",
    headers: {
      "x-clerk-user-id": userId,
    },
    redirect: "manual",
    cache: "no-store",
  });

  const redirectTarget = response.headers.get("location");
  if (redirectTarget) {
    return NextResponse.redirect(redirectTarget);
  }

  const payload = await response.text();
  return new Response(payload, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
    },
  });
}

export async function DELETE(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      {
        message: "Sign in before disconnecting Notion.",
        name: "Error",
      },
      { status: 401 },
    );
  }

  const response = await fetch(buildBackendUrl(request), {
    method: "DELETE",
    headers: {
      "x-clerk-user-id": userId,
    },
    cache: "no-store",
  });

  const payload = await response.text();
  return new Response(payload, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
    },
  });
}
