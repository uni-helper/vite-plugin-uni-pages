import { Middleware } from "./types";
export * from "./types";
export function defineMiddleware(middleware: Middleware) {
  return middleware;
}
