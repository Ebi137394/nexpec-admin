// Admin-side thin re-export of the Vault list page. The underlying fetcher
// uses RLS which automatically returns all docs for admin/super_admin.
import type { Metadata } from 'next';
import ClientVaultPage from '@/app/client/vault/page';

export const metadata: Metadata = {
  title: 'Compliance Vault · Platform-wide',
  description: 'Verify and audit every compliance document on the platform.',
};

export const dynamic = 'force-dynamic';

export default ClientVaultPage;
