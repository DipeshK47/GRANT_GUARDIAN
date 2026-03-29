import { AsyncLocalStorage } from "node:async_hooks";

type RequestContextValue = {
  clerkUserId: string | null;
};

const requestContextStorage = new AsyncLocalStorage<RequestContextValue>();

export const withRequestContext = <T>(value: RequestContextValue, fn: () => T): T => {
  return requestContextStorage.run(value, fn);
};

export const enterRequestContext = (value: RequestContextValue) => {
  requestContextStorage.enterWith(value);
};

export const getCurrentClerkUserId = () => requestContextStorage.getStore()?.clerkUserId ?? null;
