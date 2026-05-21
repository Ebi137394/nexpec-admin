// Non-server companion for vault server-action state shapes.
export interface VaultActionState {
  ok: boolean;
  error: string | null;
  message?: string;
  documentId?: string;
}

export const vaultActionInitialState: VaultActionState = {
  ok: false,
  error: null,
};
