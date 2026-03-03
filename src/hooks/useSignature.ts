import { useState, useCallback, useRef } from 'react';
import { SignatureViewRef } from 'react-native-signature-canvas';
import { SignatureData } from '../types/signature.types';
import {
  saveSignatureToFile,
  deleteSignatureFile,
  loadSignatureFromFile,
} from '../utils/signatureStorage';

interface UseSignatureOptions {
  initialValue?: SignatureData | null;
  onSave?: (data: SignatureData) => void;
  onClear?: () => void;
  onError?: (error: Error) => void;
  autoSaveToFile?: boolean;
}

interface UseSignatureReturn {
  signatureRef: React.RefObject<SignatureViewRef>;
  signatureData: SignatureData | null;
  isDrawing: boolean;
  isSaving: boolean;
  hasSignature: boolean;
  
  // Actions
  handleBegin: () => void;
  handleEnd: () => void;
  handleClear: () => void;
  handleUndo: () => void;
  handleSave: () => void;
  handleOK: (signature: string) => Promise<void>;
  handleEmpty: () => void;
  setSignatureData: (data: SignatureData | null) => void;
  loadFromFile: (fileUri: string) => Promise<boolean>;
}

export const useSignature = (options: UseSignatureOptions = {}): UseSignatureReturn => {
  const {
    initialValue = null,
    onSave,
    onClear,
    onError,
    autoSaveToFile = true,
  } = options;

  const signatureRef = useRef<SignatureViewRef>(null);
  const [signatureData, setSignatureData] = useState<SignatureData | null>(initialValue);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasSignature, setHasSignature] = useState(!!initialValue);

  const handleBegin = useCallback(() => {
    setIsDrawing(true);
    setHasSignature(true);
  }, []);

  const handleEnd = useCallback(() => {
    setIsDrawing(false);
  }, []);

  const handleClear = useCallback(async () => {
    try {
      signatureRef.current?.clearSignature();
      
      // Delete file if exists
      if (signatureData?.fileUri) {
        await deleteSignatureFile(signatureData.fileUri);
      }
      
      setSignatureData(null);
      setHasSignature(false);
      onClear?.();
    } catch (error) {
      onError?.(error as Error);
    }
  }, [signatureData, onClear, onError]);

  const handleUndo = useCallback(() => {
    signatureRef.current?.undo();
  }, []);

  const handleSave = useCallback(() => {
    signatureRef.current?.readSignature();
  }, []);

  const handleOK = useCallback(
    async (signature: string) => {
      // Check for empty signature
      if (!signature || signature === 'data:image/png;base64,') {
        handleEmpty();
        return;
      }

      setIsSaving(true);

      try {
        let fileUri: string | null = null;

        if (autoSaveToFile) {
          fileUri = await saveSignatureToFile(signature);
        }

        const data: SignatureData = {
          base64: signature,
          fileUri,
          timestamp: Date.now(),
          metadata: {
            orientation: 'landscape',
          },
        };

        setSignatureData(data);
        onSave?.(data);
      } catch (error) {
        console.error('[useSignature] Error saving:', error);
        onError?.(error as Error);
      } finally {
        setIsSaving(false);
      }
    },
    [autoSaveToFile, onSave, onError]
  );

  const handleEmpty = useCallback(() => {
    console.warn('[useSignature] Empty signature detected');
  }, []);

  const loadFromFile = useCallback(async (fileUri: string): Promise<boolean> => {
    try {
      const base64 = await loadSignatureFromFile(fileUri);
      
      if (base64) {
        setSignatureData({
          base64,
          fileUri,
          timestamp: Date.now(),
        });
        setHasSignature(true);
        return true;
      }
      
      return false;
    } catch (error) {
      onError?.(error as Error);
      return false;
    }
  }, [onError]);

  return {
    signatureRef,
    signatureData,
    isDrawing,
    isSaving,
    hasSignature,
    handleBegin,
    handleEnd,
    handleClear,
    handleUndo,
    handleSave,
    handleOK,
    handleEmpty,
    setSignatureData,
    loadFromFile,
  };
};