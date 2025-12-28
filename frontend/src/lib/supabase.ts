
import { createClient } from '@supabase/supabase-js';

// Retrieve Supabase credentials from environment variables
// You need to set these in your .env file or project settings
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Missing Supabase credentials. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Database = {
  public: {
    Tables: {
      sessions: {
        Row: {
          id: string;
          user_id: string;
          theme: string;
          quote: string;
          transcript: string | null;
          overall_score: number | null;
          content_score: number | null;
          delivery_score: number | null;
          language_score: number | null;
          body_language_score: number | null;
          duration: string | null;
          word_count: number | null;
          wpm: number | null;
          filler_word_count: number | null;
          performance_tier: string | null;
          tournament_ready: boolean | null;
          strengths: string[] | null;
          practice_drill: string | null;
          video_filename: string | null;
          full_analysis_json: string | null; // Stored as JSON string or JSONB
          created_at: string; // Postgres timestamp
        };
        Insert: {
          id?: string;
          user_id?: string; // Optional in insert if RLS handles it or default, but usually explicit
          theme: string;
          quote: string;
          transcript?: string | null;
          overall_score?: number | null;
          content_score?: number | null;
          delivery_score?: number | null;
          language_score?: number | null;
          body_language_score?: number | null;
          duration?: string | null;
          word_count?: number | null;
          wpm?: number | null;
          filler_word_count?: number | null;
          performance_tier?: string | null;
          tournament_ready?: boolean | null;
          strengths?: string[] | null;
          practice_drill?: string | null;
          video_filename?: string | null;
          full_analysis_json?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['sessions']['Insert']>;
      };
    };
  };
};

