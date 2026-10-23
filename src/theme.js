export function readThemeId() {
  try {
    return (
      localStorage.getItem("tt-theme") ||
      localStorage.getItem("tt-preview-theme")
    );
  } catch {
    return null;
  }
}

export function rememberTheme(id) {
  try {
    localStorage.setItem("tt-theme", id);
  } catch {
    // The theme still works for this visit when browser storage is unavailable.
  }
}

export function applyTheme(theme) {
  const root = document.documentElement;
  for (const name of [
    "bg",
    "surface",
    "text",
    "muted",
    "border",
    "accent",
    "secondary",
  ]) {
    root.style.setProperty(`--${name}`, theme[name]);
  }
  root.style.setProperty("--on-accent", theme.ink);
  root.style.setProperty("--on-secondary", theme.ink);
  root.style.setProperty(
    "--error",
    theme.mode === "light" ? "#A42D22" : "#FFB8AA",
  );
  root.style.colorScheme = theme.mode;
  document.querySelector('meta[name="theme-color"]').content = theme.bg;
  document.querySelector(
    'meta[name="apple-mobile-web-app-status-bar-style"]',
  ).content = theme.mode === "light" ? "default" : "black";
}

export function themeBootstrap(themes) {
  // Run in the page head so the first visible frame uses the remembered colors.
  return `(() => {
    ${readThemeId.toString()}
    ${applyTheme.toString()}
    const themes = ${JSON.stringify(themes)};
    applyTheme(themes.find(theme => theme.id === readThemeId()) || themes[0]);
  })();`;
}
