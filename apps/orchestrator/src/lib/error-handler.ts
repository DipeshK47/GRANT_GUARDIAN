import { isNotionAuthorizationError } from "../services/notion/client.js";

export type ErrorPayload = {
  message: string;
  name?: string;
};

export const toErrorPayload = (error: unknown): ErrorPayload => {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }

  return {
    message: "Unknown error",
  };
};

export const isNotionAuthError = (error: unknown): boolean => {
  return isNotionAuthorizationError(error);
};

export const isScopeError = (message: string): boolean => {
  return (
    message.includes("requested organizationId") ||
    message.includes("not scoped") ||
    message.includes("not scoped to the current Clerk user")
  );
};

export const isNotFoundError = (message: string): boolean => {
  return (
    message.includes("No opportunity exists") ||
    message.includes("No organization profile exists") ||
    message.includes("No funder exists") ||
    message.includes("No local funder record exists") ||
    message.includes("No submission session exists") ||
    message.includes("No review exists") ||
    message.includes("No draft answer exists") ||
    message.includes("No lesson exists") ||
    message.includes("No reporting entry exists") ||
    message.includes("references a missing") ||
    message.includes("missing funder") ||
    message.includes("missing submission record") ||
    message.includes("missing opportunity record")
  );
};

export const isValidationError = (message: string): boolean => {
  return (
    message.includes("requires") ||
    message.includes("No portal field mappings") ||
    message.includes("No attachment requirements") ||
    message.includes("has no requirement records") ||
    message.includes("has no draft answer yet") ||
    message.includes("still has unsupported sections") ||
    message.includes("requires a non-empty")
  );
};

export const isBadRequestError = (error: unknown, payload: ErrorPayload): boolean => {
  if (isNotionAuthError(error)) {
    return false;
  }

  return isNotFoundError(payload.message) || isValidationError(payload.message);
};

export const getStatusCodeForError = (error: unknown, payload: ErrorPayload, fallbackStatusCode = 500): number => {
  if (isNotionAuthError(error)) {
    return 401;
  }

  if (isBadRequestError(error, payload)) {
    return 400;
  }

  return fallbackStatusCode;
};

export const createRouteErrorHandler = (logger: { error: (payload: unknown, message?: string) => void }) => {
  return {
    toPayload: toErrorPayload,
    getStatusCode: (error: unknown, payload: ErrorPayload, fallbackStatusCode = 500) =>
      getStatusCodeForError(error, payload, fallbackStatusCode),
    log: (error: unknown, message: string) => {
      logger.error({ error }, message);
    },
  };
};
