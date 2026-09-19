export type User = { id: number; name: string; email: string };

export type Certificate = {
  id: string;
  certificate_code: string;
  signature?: string;
  issued_at: string;
};

export type DocumentVersion = {
  id: string;
  version_number: number;
  snapshot_html: string;
  snapshot_text: string;
  word_count: number;
  content_hash: string;
  process_hash?: string | null;
  sealed_at: string;
  certificate?: Certificate | null;
};

export type VeritasDocument = {
  id: string;
  owner_id: number;
  title: string;
  content_html: string;
  content_text: string;
  word_count: number;
  status: "draft" | "archived";
  created_at: string;
  updated_at: string;
  last_session_at?: string | null;
  versions_count?: number;
  sessions_count?: number;
  versions?: DocumentVersion[];
};

export type WritingEvent = {
  id?: number;
  sequence: number;
  event_type: "start" | "insert" | "delete" | "paste" | "paste_edit" | "format" | "focus" | "blur" | "save";
  input_type?: string | null;
  data?: string | null;
  after_html: string;
  elapsed_ms: number;
  created_at?: string;
  server_received_at?: string;
};

export type Submission = {
  id: string;
  document_version_id: string;
  sender_id: number;
  recipient_user_id?: number | null;
  recipient_email?: string | null;
  note?: string | null;
  status: string;
  submitted_at: string;
};
