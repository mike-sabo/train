export function databaseHeaders(getEnv) {
  const configured = getEnv("SUPABASE_SECRET_KEYS");
  if (configured) {
    const key = JSON.parse(configured).default;
    if (typeof key !== "string" || !key.startsWith("sb_secret_"))
      throw new Error("Configure a default Supabase secret API key.");
    // Modern secret keys belong only in apikey; they are not bearer JWTs.
    return { "Content-Type": "application/json", apikey: key };
  }
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("No server-side Supabase API key is configured.");
  return {
    "Content-Type": "application/json",
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
}
