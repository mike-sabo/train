import { z } from "zod";
import { planSchema, logSchema, dateSchema, today } from "../server/schema.js";
import { historyFromRows } from "../server/history.js";
import { themes } from "../shared/themes.js";

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const inviteSchema = z
  .object({ email: emailSchema, name: z.string().trim().min(1).max(60) })
  .strict();
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const hex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const hash = async (value) =>
  hex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  );
function randomCode() {
  // Reject the uneven tail instead of biasing the six-digit code distribution.
  const maximum = Math.floor(2 ** 32 / 900000) * 900000;
  let value;
  do {
    value = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (value >= maximum);
  return String(100000 + (value % 900000));
}

export function createHostedHandler({
  rpc,
  sendEmail,
  origin,
  appPath = "/",
  ownerEmail,
}) {
  const owner = emailSchema.parse(ownerEmail);
  if (new URL(origin).origin !== origin || !origin.startsWith("https://"))
    throw new Error("APP_ORIGIN must be an HTTPS origin without a path.");
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(appPath))
    throw new Error("APP_PATH must be / or a path with a trailing slash.");
  let ready;
  async function call(action, payload, session, ip) {
    const result = await rpc(action, payload, session, ip);
    if (!result || !Number.isInteger(result.status))
      throw new Error("Invalid database response.");
    if (result.status >= 400) fail(result.status, result.data.error);
    return result.data;
  }
  return async function handler(request) {
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      Vary: "Origin",
    };
    const requestOrigin = request.headers.get("origin");
    if (requestOrigin === origin) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, OPTIONS";
      headers["Access-Control-Allow-Headers"] = "authorization, content-type";
    }
    const respond = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers });
    try {
      if (
        (requestOrigin && requestOrigin !== origin) ||
        (request.method !== "GET" && requestOrigin !== origin)
      )
        fail(403, "This request must come from Train Together.");
      if (request.method === "OPTIONS")
        return new Response(null, { status: 204, headers });
      const url = new URL(request.url);
      const prefix = "/train-together";
      const offset = url.pathname.indexOf(prefix);
      const path =
        offset >= 0 ? url.pathname.slice(offset + prefix.length) : url.pathname;
      const route = `${request.method} ${path}`;
      const known = [
        "GET /status",
        "POST /auth/send",
        "POST /auth/verify",
        "POST /auth/logout",
        "GET /state",
        "GET /history",
        "PUT /preferences",
        "POST /invites",
        "POST /plans",
        "POST /blocks",
      ];
      if (
        !known.includes(route) &&
        !/^POST \/members\/\d+\/revoke$/.test(route) &&
        !/^PUT \/logs\/\d{4}-\d{2}-\d{2}$/.test(route)
      )
        fail(404, "Not found.");
      // Failed startup can be retried after configuration or connectivity is repaired.
      ready ??= call("bootstrap", { email: owner }).catch((error) => {
        ready = undefined;
        throw error;
      });
      await ready;
      let body = {};
      if (request.method !== "GET") {
        if (
          !request.headers.get("content-type")?.startsWith("application/json")
        )
          fail(415, "Send JSON data.");
        // Bound the stream before parsing so oversized requests cannot exhaust an isolate.
        const reader = request.body?.getReader();
        const chunks = [];
        let length = 0;
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.length;
            if (length > 131072) {
              await reader.cancel();
              fail(413, "This request is too large.");
            }
            chunks.push(value);
          }
        }
        const bytes = new Uint8Array(length);
        let position = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, position);
          position += chunk.length;
        }
        try {
          body = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          fail(400, "Send valid JSON data.");
        }
      }
      const token = request.headers
        .get("authorization")
        ?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
      const session = token ? await hash(token) : "";
      // Email and daily budget limits also apply; forwarded IPs are supplemental.
      const ip = await hash(
        (request.headers.get("x-forwarded-for") || "unknown").slice(0, 500),
      );
      const run = (action, payload = {}) => call(action, payload, session, ip);
      if (route === "GET /status") return respond(await run("status"));
      if (route === "POST /auth/send") {
        const email = emailSchema.parse(body.email);
        const requestId = randomToken();
        const prepared = await run("auth_send_prepare", {
          email,
          request: requestId,
        });
        if (prepared.send) {
          const code = randomCode();
          await sendEmail(
            email,
            "Your Train Together sign-in code",
            `Your code is ${code}. It expires in 10 minutes. If you did not request it, ignore this email.`,
          );
          await run("auth_send_commit", {
            email,
            request: requestId,
            accessVersion: prepared.accessVersion,
            codeHash: await hash(code),
          });
        }
        return respond({ ok: true });
      }
      if (route === "POST /auth/verify") {
        const { email, code } = z
          .object({ email: emailSchema, code: z.string().regex(/^\d{6}$/) })
          .parse(body);
        const nextToken = randomToken();
        await run("auth_verify", {
          email,
          codeHash: await hash(code),
          tokenHash: await hash(nextToken),
        });
        return respond({ ok: true, token: nextToken });
      }
      if (route === "POST /auth/logout") return respond(await run("logout"));
      if (route === "GET /state")
        return respond(
          await run("state", {
            week: dateSchema.parse(url.searchParams.get("week") || today()),
          }),
        );
      if (route === "GET /history") {
        const before = dateSchema.parse(url.searchParams.get("before"));
        const result = await run("history", { before });
        return respond({
          history: result.plan
            ? historyFromRows(result.plan, before, result.rows)
            : {},
        });
      }
      if (route === "PUT /preferences")
        return respond(
          await run(
            "preferences",
            z
              .object({ theme: z.enum(themes.map((t) => t.id)) })
              .strict()
              .parse(body),
          ),
        );
      if (route === "POST /invites") {
        const data = inviteSchema.parse(body);
        const prepared = await run("invite_prepare", data);
        await sendEmail(
          data.email,
          "You’re invited to Train Together",
          `Mike has invited you to Train Together. Accept your invitation by signing in with this email address at ${origin}${appPath}. We will email you a verification code. Iron sharpens iron. — Proverbs 27:17`,
        );
        return respond(
          await run("invite_commit", {
            ...data,
            accessVersion: prepared.accessVersion,
          }),
        );
      }
      if (route === "POST /plans")
        return respond(await run("plan", planSchema.parse(body)));
      if (route === "POST /blocks")
        return respond(
          await run(
            "block",
            z
              .object({
                planKey: z.string().max(100),
                start: dateSchema,
                weeks: z.number().int().min(1).max(52),
              })
              .parse(body),
          ),
        );
      if (route.startsWith("POST /members/"))
        return respond(
          await run("revoke", {
            id: z.coerce
              .number()
              .int()
              .positive()
              .max(2147483647)
              .parse(path.split("/")[2]),
          }),
        );
      if (route.startsWith("PUT /logs/"))
        return respond(
          await run("log", {
            ...logSchema.parse(body),
            date: dateSchema.parse(path.split("/")[2]),
          }),
        );
    } catch (error) {
      if (error instanceof z.ZodError)
        return respond(
          { error: error.issues.map((i) => i.message).join(" ") },
          400,
        );
      // Never return database errors, credentials, or email provider responses.
      return respond(
        {
          error: error.status
            ? error.message
            : "The server is unavailable. Please try again shortly.",
        },
        error.status || 503,
      );
    }
  };
}
