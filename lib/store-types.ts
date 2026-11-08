/** Documents the global draft/clipboard store contract used by client.js. */
export type FormKey =
  | 'eventForm'
  | 'ideaForm'
  | 'governmentForm'
  | 'missionForm'
  | string;

export interface DraftMeta {
  updatedAt: number;
  dirty: boolean;
  saved: boolean;
}

export interface ClipboardData<T = unknown> {
  data: T;
  source: FormKey;
  copiedAt: number;
}

export interface PersistedStore {
  draftStates: Record<FormKey, any>;
  draftMeta: Record<FormKey, DraftMeta>;
  clipboardData: ClipboardData | null;
}

export interface ActiveForm {
  key: FormKey;
  getValue: () => unknown;
  onPaste: (data: unknown) => void;
}

export interface GlobalStore extends PersistedStore {
  activeForm: ActiveForm | null;
  subscribe: (listener: () => void) => () => void;
  getState: () => GlobalStore;
  setDraft: (key: FormKey, data: unknown, markDirty?: boolean) => void;
  saveDraft: (key: FormKey) => void;
  saveAllDrafts: () => void;
  clearDraft: (key: FormKey) => void;
  hasDirtyDrafts: () => boolean;
  setClipboard: (data: unknown, source: FormKey) => void;
  clearClipboard: () => void;
  setActiveForm: (form: ActiveForm) => void;
  clearActiveForm: (key: FormKey) => void;
}

export interface DraftHandle {
  clear: () => void;
  save: () => void;
}
