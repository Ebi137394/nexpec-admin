// src/types/signature.types.ts
export interface SignatureData {
  /** Base64 encoded PNG image of the signature */
  base64: string;
  /** Local file URI where the signature is stored */
  fileUri: string | null;
  /** Timestamp when signature was captured */
  timestamp: number;
  /** Optional metadata */
  metadata?: {
    deviceInfo?: string;
    orientation?: 'portrait' | 'landscape';
    dimensions?: {
      width: number;
      height: number;
    };
  };
}

export interface SignatureFieldProps<T extends Record<string, any>> {
  /** react-hook-form control object */
  control: any;
  /** Field name in the form */
  name: keyof T & string;
  /** Label text displayed above the field */
  label?: string;
  /** Whether the field is required */
  required?: boolean;
  /** Placeholder text when no signature exists */
  placeholder?: string;
  /** Callback when signature changes */
  onSignatureChange?: (data: SignatureData | null) => void;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Maximum preview width */
  maxPreviewWidth?: number;
  /** Preview height */
  previewHeight?: number;
  /** Stroke width for the pen */
  strokeWidth?: number;
  /** Custom validation rules */
  rules?: Record<string, any>;
  /** Whether to show timestamp */
  showTimestamp?: boolean;
  /** Custom error message */
  errorMessage?: string;
}

export interface SignatureModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (data: SignatureData) => void;
  initialSignature?: string;
  strokeWidth?: number;
  title?: string;
}

export interface SignatureStorageOptions {
  directory?: string;
  filePrefix?: string;
  quality?: number;
}