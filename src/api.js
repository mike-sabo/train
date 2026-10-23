export function createApiClient({
  base = "/api",
  storage,
  fetcher = fetch,
} = {}) {
  const hosted = /^https?:\/\//.test(base);
  const tokenKey = `tt-session:${base}`;
  let token = "";
  try {
    token = hosted ? storage?.getItem(tokenKey) || "" : "";
  } catch {
    // Private browsing can disable storage. Sign-in still works for this tab.
  }
  function remember(value) {
    token = value;
    try {
      if (value) storage?.setItem(tokenKey, value);
      else storage?.removeItem(tokenKey);
    } catch {
      // Keep the in-memory session when persistent storage is unavailable.
    }
  }
  return async function api(path, body, method) {
    const headers = body ? { "Content-Type": "application/json" } : {};
    if (hosted && token) headers.Authorization = `Bearer ${token}`;
    const response = await fetcher(base.replace(/\/$/, "") + path, {
      method: method ?? (body ? "POST" : "GET"),
      credentials: hosted ? "omit" : "same-origin",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("The server could not be reached. Please try again.");
    }
    if (hosted && response.status === 401) remember("");
    if (!response.ok)
      throw Object.assign(new Error(data.error || "Please try again."), {
        status: response.status,
      });
    if (hosted && path === "/auth/verify" && data.token) remember(data.token);
    if (hosted && path === "/auth/logout") remember("");
    return data;
  };
}

let storage;
try {
  storage = globalThis.localStorage;
} catch {
  // Some browsers deny access to localStorage itself.
}
export const api = createApiClient({
  base: import.meta.env?.VITE_API_URL || "/api",
  storage,
});
