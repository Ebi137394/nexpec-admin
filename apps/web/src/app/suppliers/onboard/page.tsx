// /suppliers/onboard — legacy entry point. The onboarding + edit flow is now the
// unified Profile page; redirect there so old links keep working.
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function SupplierOnboardRedirect() {
  redirect('/suppliers/profile');
}
