import { createServerFn } from "@tanstack/react-start";
import { setCookie, getCookie, deleteCookie } from "@tanstack/react-start/server";
import { z } from "zod";

const COOKIE_NAME = "receipt_roamer_auth_session";

// 7 days in seconds
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export const loginFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => loginSchema.parse(input))
  .handler(async ({ data }) => {
    const { email, password } = data;

    const expectedEmail = process.env.APP_LOGIN_EMAIL;
    const expectedPassword = process.env.APP_LOGIN_PASSWORD;

    if (!expectedEmail || !expectedPassword) {
      console.warn("Auth: Missing APP_LOGIN_EMAIL or APP_LOGIN_PASSWORD in environment.");
      return { success: false, error: "Server misconfiguration. Cannot login." };
    }

    if (email === expectedEmail && password === expectedPassword) {
      // Set secure HTTP-only cookie
      setCookie(COOKIE_NAME, "true", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: SESSION_MAX_AGE,
        sameSite: "lax",
      });
      return { success: true };
    }

    return { success: false, error: "Invalid email or password" };
  });

export const logoutFn = createServerFn({ method: "POST" }).handler(async () => {
  deleteCookie(COOKIE_NAME, { path: "/" });
  return { success: true };
});

export const checkAuthFn = createServerFn({ method: "GET" }).handler(async () => {
  const cookieVal = getCookie(COOKIE_NAME);
  return cookieVal === "true";
});
