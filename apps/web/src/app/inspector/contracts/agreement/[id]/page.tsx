'use client';
// Portal-hosted spine Review & Sign (inspector_engagement). Inherits the Inspector
// sidebar + adds back/breadcrumb — no dead-ends. Reached from /inspector/contracts.
import { useParams } from 'next/navigation';
import { SpineAgreementSign } from '@/components/contracts/SpineAgreementSign';

export default function InspectorAgreementSignPage() {
  const params = useParams<{ id: string }>();
  return (
    <SpineAgreementSign
      agreementId={(params?.id ?? '') as string}
      backHref="/inspector/contracts"
      portalLabel="Inspector Portal"
    />
  );
}
