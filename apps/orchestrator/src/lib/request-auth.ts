import type { FastifyRequest } from "fastify";

export const normalizeRequestText = (value?: string | null) =>
  (value ?? "").replace(/\s+/g, " ").trim();

export const getClerkUserIdFromRequest = (request: FastifyRequest) => {
  const headerValue = request.headers["x-clerk-user-id"];
  if (Array.isArray(headerValue)) {
    return normalizeRequestText(headerValue[0]) || null;
  }

  return normalizeRequestText(headerValue) || null;
};
