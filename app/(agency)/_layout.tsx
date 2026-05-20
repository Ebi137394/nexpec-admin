// Passthrough — equivalent to having no _layout.tsx in this route group.
// (Sandbox couldn't unlink the file, so Slot is the next-cleanest thing.)
import { Slot } from 'expo-router';
export default function AgencyGroupLayout() {
  return <Slot />;
}
