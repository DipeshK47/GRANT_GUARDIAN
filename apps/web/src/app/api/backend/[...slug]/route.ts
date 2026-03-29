import type { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";

const appBaseUrl =
  process.env.NEXT_PUBLIC_APP_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:4000";

const buildTargetUrl = (request: NextRequest, slug: string[]) => {
  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(slug.join("/"), `${appBaseUrl.replace(/\/+$/, "")}/`);

  incomingUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.append(key, value);
  });

  return targetUrl;
};

const proxy = async (request: NextRequest, slug: string[]) => {
  const { userId } = await auth();
  const targetUrl = buildTargetUrl(request, slug);
  const bodyText =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();

  const response = await fetch(targetUrl, {
    method: request.method,
    headers: {
      "content-type": request.headers.get("content-type") ?? "application/json",
      ...(userId ? { "x-clerk-user-id": userId } : {}),
    },
    body: bodyText,
    cache: "no-store",
  });

  const responseText = await response.text();
  const contentType = response.headers.get("content-type") ?? "application/json";

  return new Response(responseText, {
    status: response.status,
    headers: {
      "content-type": contentType,
    },
  });
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string[] }> },
) {
  const { slug } = await context.params;
  return proxy(request, slug);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string[] }> },
) {
  const { slug } = await context.params;
  return proxy(request, slug);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ slug: string[] }> },
) {
  const { slug } = await context.params;
  return proxy(request, slug);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ slug: string[] }> },
) {
  const { slug } = await context.params;
  return proxy(request, slug);
}
