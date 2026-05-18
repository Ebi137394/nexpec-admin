export interface PendingPhoto {
  localUri: string;
  fileName: string;
  mimeType: string;
  uploadedUrl?: string;
}

export interface PendingReport {
  id: string;                          // Client-generated UUID
  projectId: string;
  inspectorId: string;
  summary: string;
  findings?: string;
  recommendations?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  photos: PendingPhoto[];
  signatureLocalUri?: string;
  signatureUploadedUrl?: string;
  metadata: Record<string, any>;       // Any extra fields your form captures
  createdAt: string;                   // ISO timestamp when queued
  status: QueueItemStatus;
  retryCount: number;
  lastAttempt?: string;
  lastError?: string;
}

export type QueueItemStatus =
  | 'pending'
  | 'uploading_photos'
  | 'uploading_signature'
  | 'inserting'
  | 'completed'
  | 'failed';

export interface SyncQueueState {
  items: PendingReport[];
  lastSyncAttempt?: string;
  version: number;                     // Schema version for future migrations
}

export interface SyncResult {
  success: boolean;
  processedCount: number;
  failedCount: number;
  errors: Array<{ reportId: string; error: string }>;
}

export interface SyncEngineEvent {
  type: 'sync_start' | 'sync_complete' | 'item_processing' | 'item_success' | 'item_failed' | 'queue_empty';
  reportId?: string;
  detail?: string;
  timestamp: string;
}