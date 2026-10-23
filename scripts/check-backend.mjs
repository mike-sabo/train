const base = process.env.VITE_API_URL;
const origin = process.env.APP_ORIGIN;
if (!base || !origin)
  throw new Error("Configure VITE_API_URL and APP_ORIGIN before publishing.");
const response = await fetch(`${base}/status`, {
  headers: { Origin: origin },
  signal: AbortSignal.timeout(20000),
});
const status = await response.json();
if (
  !response.ok ||
  status.emailMode !== "resend" ||
  status.setup !== false ||
  response.headers.get("access-control-allow-origin") !== origin
)
  throw new Error("The hosted backend is not ready for this website origin.");
const privateResponse = await fetch(`${base}/state`, {
  headers: { Origin: origin },
  signal: AbortSignal.timeout(20000),
});
if (privateResponse.status !== 401)
  throw new Error("The backend did not require sign-in for private data.");
console.log("Hosted backend is ready and private data requires sign-in.");
