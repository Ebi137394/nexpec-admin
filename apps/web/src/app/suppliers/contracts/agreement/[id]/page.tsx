'use client';
// Portal-hosted spine Review & Sign (supplier_supply). Inherits the Supplier
// sidebar + adds back/breadcrumb — no dead-ends. Reached from /suppliers/contracts.
import { useParams } from 'next/navigation';
import { SpineAgreementSign } from '@/components/contracts/SpineAgreementSign';

export default function SupplierAgreementSignPage() {
  const params = useParams<{ id: string }>();
  return (
    <SpineAgreementSign
      agreementId={(params?.id ?? '') as string}
      backHref="/suppliers/contracts"
      portalLabel="Supplier Portal"
    />
  );
}
