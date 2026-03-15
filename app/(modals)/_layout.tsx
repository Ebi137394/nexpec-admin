// app/(modals)/_layout.tsx

import { Stack } from "expo-router";

export default function ModalLayout() {
  return (
    <Stack
      screenOptions={{
        presentation: "modal",
        headerShown: false,
        contentStyle: { backgroundColor: "#0F172A" },
        animation: "slide_from_bottom",
      }}
    />
  );
}