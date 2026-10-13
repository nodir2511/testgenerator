export type UserRole = 'user' | 'admin';

export type QuestionType = 'test' | 'matching' | 'open';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export interface Subject {
  id: string;
  name: string;
  is_deleted: boolean;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface Chapter {
  id: string;
  subject_id: string;
  name: string;
  order_index: number;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface Topic {
  id: string;
  chapter_id: string;
  name: string;
  order_index: number;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface Source {
  id: string;
  name: string;
  is_deleted: boolean;
  created_at: string;
}

export interface QuestionOption {
  id: string;
  question_id?: string;
  text: string;
  text_ru?: string | null;
  text_tg?: string | null;
  image_url?: string | null;
  is_correct?: boolean;
  order_index: number;
}

export interface MatchingItem {
  id: string;
  question_id?: string;
  side: 'left' | 'right';
  text: string;
  text_ru?: string | null;
  text_tg?: string | null;
  image_url?: string | null;
  order_index: number;
  correct_match_id?: string | null;
}

export interface Question {
  id: string;
  subject_id: string;
  chapter_id: string;
  topic_id: string;
  source_id?: string | null;
  batch_id?: string | null;
  type: QuestionType;
  content: string;
  content_ru?: string | null;
  content_tg?: string | null;
  image_url?: string | null;
  correct_numeric_answer?: number | null;
  seq?: number | null;
  num?: number | null;
  version: number;
  is_deleted: boolean;
  deleted_at?: string | null;
  deleted_by?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
  // Joined relation fields:
  options?: QuestionOption[];
  matching_items?: MatchingItem[];
  subject?: Subject;
  chapter?: Chapter;
  topic?: Topic;
  source?: Source;
}

export interface QuestionSnapshot {
  id: string;
  type: QuestionType;
  content: string;
  image_url?: string | null;
  correct_numeric_answer?: number | null;
  options?: Array<{
    id: string;
    text: string;
    image_url?: string | null;
    order_index: number;
  }>;
  matching_items?: Array<{
    id: string;
    side: 'left' | 'right';
    text: string;
    image_url?: string | null;
    order_index: number;
  }>;
  topic_name?: string;
  chapter_name?: string;
  subject_name?: string;
}

export interface TicketBatch {
  id: string;
  title: string;
  subject_id: string;
  created_by?: string;
  generation_params: {
    chapter_ids: string[];
    topic_ids: string[];
    test_count: number;
    matching_count: number;
    open_count: number;
    ticket_count: number;
  };
  created_at: string;
  tickets?: Ticket[];
}

export interface Ticket {
  id: string;
  batch_id: string;
  ticket_number: number;
  created_at: string;
  questions?: TicketQuestion[];
}

export interface TicketQuestion {
  id: string;
  ticket_id: string;
  question_id?: string | null;
  order_index: number;
  question_snapshot: QuestionSnapshot;
}

export interface ImportBatch {
  id: string;
  created_by?: string;
  filename?: string | null;
  items_count: number;
  is_reverted: boolean;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id?: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  details?: Record<string, unknown> | null;
  created_at: string;
}
