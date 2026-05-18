module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }]
      // ❌ "nativewind/babel" رو حذف کردیم چون مال نسخه ۲ بود
    ],
    plugins: [
      // ✅ ری‌انیمیتد حتماً باید آخرین مورد باشه
      "react-native-reanimated/plugin",
    ],
  };
};