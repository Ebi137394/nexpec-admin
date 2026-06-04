// src/components/DynamicForm/types.ts

export interface FormFieldOption {
  label: string;
  value: string;
}

export interface FormFieldValidation {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  patternMessage?: string;
}

export interface FormField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'photo' | 'video' | 'signature' | 'date' | 'document';
  required?: boolean;
  placeholder?: string;
  options?: FormFieldOption[];
  validation?: FormFieldValidation;
  defaultValue?: string | number | Date;
  helperText?: string;
  /** For type:'document' — which Vendor Custody doc_type this field captures
   *  (iso_cert | accreditation | insurance | financial | nda | msa |
   *   technical_proposal | mill_cert | other). Defaults to 'other'. */
  docType?: string;
}

export interface FormSchema {
  fields: FormField[];
}

export interface DynamicFormProps {
  schema: FormField[];
  onSubmit: (data: Record<string, any>) => void | Promise<void>;
  submitButtonText?: string;
  isLoading?: boolean;
  defaultValues?: Record<string, any>;
}

export interface FieldProps {
  field: FormField;
  value: any;
  onChange: (value: any) => void;
  onBlur: () => void;
  error?: string;
}