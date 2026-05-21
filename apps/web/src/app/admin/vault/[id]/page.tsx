// Admin-side thin re-export of the Vault document detail page. The
// VaultDocumentActions component renders admin verify buttons when
// the auth-resolved role is admin/super_admin.
import type { Metadata } from 'next';
import VaultDocumentPage from '@/app/client/vault/[id]/page';

export const metadata: Metadata = {
  title: 'Vault Document',
};

export const dynamic = 'force-dynamic';

export default VaultDocumentPage;
