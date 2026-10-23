import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { themes } from "../shared/themes.js";
import { themeBootstrap } from "../src/theme.js";

function boot(storage) {
  const colors = {};
  const metas = {
    'meta[name="theme-color"]': {},
    'meta[name="apple-mobile-web-app-status-bar-style"]': {},
  };
  const style = {
    setProperty: (name, value) => {
      colors[name] = value;
    },
  };
  const context = {
    document: {
      documentElement: { style },
      querySelector: (selector) => metas[selector],
    },
    get localStorage() {
      if (storage instanceof Error) throw storage;
      return { getItem: (key) => storage[key] ?? null };
    },
  };
  runInNewContext(themeBootstrap(themes), context);
  return { colors, style, metas };
}

test("the page head restores every saved theme before the app starts", () => {
  for (const theme of themes) {
    const { colors, style, metas } = boot({ "tt-theme": theme.id });
    assert.equal(colors["--bg"], theme.bg);
    assert.equal(colors["--text"], theme.text);
    assert.equal(colors["--on-accent"], theme.ink);
    assert.equal(style.colorScheme, theme.mode);
    assert.equal(metas['meta[name="theme-color"]'].content, theme.bg);
    assert.equal(
      metas['meta[name="apple-mobile-web-app-status-bar-style"]'].content,
      theme.mode === "light" ? "default" : "black",
    );
  }
});

test("existing preview preferences carry over until an account theme is cached", () => {
  assert.equal(
    boot({ "tt-preview-theme": "porcelain-teal" }).colors["--bg"],
    themes[9].bg,
  );
  assert.equal(
    boot({ "tt-theme": "ocean-mint", "tt-preview-theme": "porcelain-teal" })
      .colors["--bg"],
    themes[3].bg,
  );
});

test("missing, invalid, or blocked storage safely uses the default theme", () => {
  for (const storage of [
    {},
    { "tt-theme": "unknown" },
    new Error("Storage blocked"),
  ]) {
    assert.equal(boot(storage).colors["--bg"], themes[0].bg);
  }
});
