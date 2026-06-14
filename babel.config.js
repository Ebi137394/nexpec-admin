module.exports = function (api) {
  // Cache must vary by env so the production console-strip below is not reused in dev.
  api.cache.using(() => process.env.NODE_ENV);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }]
      // ❌ "nativewind/babel" رو حذف کردیم چون مال نسخه ۲ بود
    ],
    plugins: [
      // Production builds only: strip console.log / console.info / console.debug
      // from the shipped bundle so no client logging can leak data. error + warn
      // are kept for crash diagnostics. Dev keeps all logs.
      ...(process.env.NODE_ENV === "production"
        ? [["transform-remove-console", { exclude: ["error", "warn"] }]]
        : []),
      // ✅ ری‌انیمیتد حتماً باید آخرین مورد باشه — must stay LAST.
      "react-native-reanimated/plugin",
    ],
  };
};