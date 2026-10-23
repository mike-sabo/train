import { createHostedHandler } from "./handler.js";
import { databaseHeaders } from "./database-headers.js";

function required(name) {
  const value = Deno.env.get(name);
  if (!value)
    throw new Error(`Configure ${name} in Supabase function secrets.`);
  return value;
}
const supabaseUrl = required("SUPABASE_URL");
const serviceHeaders = databaseHeaders((name) => Deno.env.get(name));
const mailKey = required("RESEND_API_KEY");
const mailFrom = required("EMAIL_FROM");

Deno.serve(
  createHostedHandler({
    origin: required("APP_ORIGIN"),
    appPath: Deno.env.get("APP_PATH") || "/",
    ownerEmail: required("OWNER_EMAIL"),
    async rpc(action, payload = {}, session = "", ip = "") {
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/tt_rpc`, {
        method: "POST",
        headers: serviceHeaders,
        body: JSON.stringify({
          p_action: action,
          p_payload: payload,
          p_session: session,
          p_ip: ip,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("Database request failed.");
      return response.json();
    },
    async sendEmail(email, subject, text) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${mailKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: mailFrom, to: [email], subject, text }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        throw Object.assign(
          new Error("Email delivery failed. Please try again shortly."),
          { status: 502 },
        );
    },
  }),
);
