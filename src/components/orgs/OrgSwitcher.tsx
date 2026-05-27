// ════════════════════════════════════════════════════════════════════════════
//  src/components/orgs/OrgSwitcher.tsx
//
//  All-in-one wrapper that pairs the trigger pill with the bottom sheet
//  so a host screen can drop in a single component without managing the
//  sheet ref. Use this for the vast majority of mount points.
//
//  Advanced consumers (e.g. when the trigger lives in a header that's
//  not a sibling of where the sheet should mount) can compose
//  OrgSwitcherTrigger + OrgSwitcherSheet manually and own the ref.
//
//  IMPORTANT: must be rendered inside a <BottomSheetModalProvider> — the
//  project's root layout already provides one for ContractEditorModal etc.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useRef } from 'react';
import type { BottomSheetModal } from '@gorhom/bottom-sheet';

import { OrgSwitcherSheet } from './OrgSwitcherSheet';
import { OrgSwitcherTrigger } from './OrgSwitcherTrigger';

interface Props {
  /** Pass compact when mounting inside a tight header / row. */
  compact?: boolean;
}

export function OrgSwitcher({ compact = false }: Props) {
  const sheetRef = useRef<BottomSheetModal>(null);

  const open = useCallback(() => {
    sheetRef.current?.present();
  }, []);

  return (
    <>
      <OrgSwitcherTrigger onPress={open} compact={compact} />
      <OrgSwitcherSheet sheetRef={sheetRef} />
    </>
  );
}
