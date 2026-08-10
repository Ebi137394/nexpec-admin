// ─────────────────────────────────────────────────────────────────
//  Fake `expo-file-system`. In-memory file table so the deferred
//  photo-upload branch of the real handlers executes for real.
// ─────────────────────────────────────────────────────────────────

export const EncodingType = { Base64: 'base64', UTF8: 'utf8' };

export const fsState = {
  /** uri -> base64 contents */
  files: new Map(),
  /** uris passed to deleteAsync */
  deleted: [],
  reset() {
    this.files.clear();
    this.deleted.length = 0;
  },
};

export async function getInfoAsync(uri) {
  return { exists: fsState.files.has(uri), uri, isDirectory: false };
}

export async function readAsStringAsync(uri) {
  const v = fsState.files.get(uri);
  if (v === undefined) throw new Error(`ENOENT: ${uri}`);
  return v;
}

export async function deleteAsync(uri) {
  fsState.deleted.push(uri);
  fsState.files.delete(uri);
}

export default { EncodingType, getInfoAsync, readAsStringAsync, deleteAsync };
