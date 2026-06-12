export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string;
          actor_email: string | null;
          actor_name: string | null;
          actor_user_id: string | null;
          created_at: string;
          entity_id: string | null;
          entity_ref: string | null;
          entity_type: string | null;
          id: string;
          metadata: Json;
          tenant_id: string;
        };
        Insert: {
          action: string;
          actor_email?: string | null;
          actor_name?: string | null;
          actor_user_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_ref?: string | null;
          entity_type?: string | null;
          id?: string;
          metadata?: Json;
          tenant_id: string;
        };
        Update: {
          action?: string;
          actor_email?: string | null;
          actor_name?: string | null;
          actor_user_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_ref?: string | null;
          entity_type?: string | null;
          id?: string;
          metadata?: Json;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "activity_log_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      admin_credentials: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          password: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          password?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          password?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      ai_conversations: {
        Row: {
          content: string;
          created_at: string | null;
          id: string;
          role: string;
          session_id: string;
          tenant_id: string;
          user_id: string;
        };
        Insert: {
          content: string;
          created_at?: string | null;
          id?: string;
          role: string;
          session_id: string;
          tenant_id: string;
          user_id: string;
        };
        Update: {
          content?: string;
          created_at?: string | null;
          id?: string;
          role?: string;
          session_id?: string;
          tenant_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_conversations_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_knowledge_chunks: {
        Row: {
          chunk_text: string;
          created_at: string | null;
          embedding: string | null;
          id: string;
          is_global: boolean | null;
          metadata: Json | null;
          search_vector: unknown;
          source_path: string | null;
          source_type: string;
          tenant_id: string | null;
        };
        Insert: {
          chunk_text: string;
          created_at?: string | null;
          embedding?: string | null;
          id?: string;
          is_global?: boolean | null;
          metadata?: Json | null;
          search_vector?: unknown;
          source_path?: string | null;
          source_type: string;
          tenant_id?: string | null;
        };
        Update: {
          chunk_text?: string;
          created_at?: string | null;
          embedding?: string | null;
          id?: string;
          is_global?: boolean | null;
          metadata?: Json | null;
          search_vector?: unknown;
          source_path?: string | null;
          source_type?: string;
          tenant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ai_knowledge_chunks_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_pending_actions: {
        Row: {
          action_type: string;
          created_at: string | null;
          expires_at: string | null;
          id: string;
          params: Json;
          tenant_id: string;
          user_id: string;
        };
        Insert: {
          action_type: string;
          created_at?: string | null;
          expires_at?: string | null;
          id?: string;
          params: Json;
          tenant_id: string;
          user_id: string;
        };
        Update: {
          action_type?: string;
          created_at?: string | null;
          expires_at?: string | null;
          id?: string;
          params?: Json;
          tenant_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_pending_actions_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_query_logs: {
        Row: {
          created_at: string | null;
          id: string;
          latency_ms: number | null;
          question: string;
          retrieved_chunk_ids: string[] | null;
          tenant_id: string;
          token_usage: number | null;
          user_id: string;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          latency_ms?: number | null;
          question: string;
          retrieved_chunk_ids?: string[] | null;
          tenant_id: string;
          token_usage?: number | null;
          user_id: string;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          latency_ms?: number | null;
          question?: string;
          retrieved_chunk_ids?: string[] | null;
          tenant_id?: string;
          token_usage?: number | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_query_logs_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_planning_log: {
        Row: {
          action: string;
          created_at: string;
          driver_id: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          new_value: Json | null;
          old_value: Json | null;
          planner_user_id: string | null;
          tenant_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_planning_log_driver_id_fkey1";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "audit_planning_log_tenant_id_fkey1";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_planning_log_2026_01: {
        Row: {
          action: string;
          created_at: string;
          driver_id: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          new_value: Json | null;
          old_value: Json | null;
          planner_user_id: string | null;
          tenant_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      audit_planning_log_2026_02: {
        Row: {
          action: string;
          created_at: string;
          driver_id: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          new_value: Json | null;
          old_value: Json | null;
          planner_user_id: string | null;
          tenant_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      audit_planning_log_2026_03: {
        Row: {
          action: string;
          created_at: string;
          driver_id: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          new_value: Json | null;
          old_value: Json | null;
          planner_user_id: string | null;
          tenant_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      audit_planning_log_2026_04: {
        Row: {
          action: string;
          created_at: string;
          driver_id: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          new_value: Json | null;
          old_value: Json | null;
          planner_user_id: string | null;
          tenant_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      audit_planning_log_2026_05: {
        Row: {
          action: string;
          created_at: string;
          driver_id: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          new_value: Json | null;
          old_value: Json | null;
          planner_user_id: string | null;
          tenant_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      audit_planning_log_2026_06: {
        Row: {
          action: string;
          created_at: string;
          driver_id: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          new_value: Json | null;
          old_value: Json | null;
          planner_user_id: string | null;
          tenant_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      audit_planning_log_2026_07: {
        Row: {
          action: string;
          created_at: string;
          driver_id: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          new_value: Json | null;
          old_value: Json | null;
          planner_user_id: string | null;
          tenant_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      audit_planning_log_2026_08: {
        Row: {
          action: string;
          created_at: string;
          driver_id: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          new_value: Json | null;
          old_value: Json | null;
          planner_user_id: string | null;
          tenant_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      audit_planning_log_2026_09: {
        Row: {
          action: string;
          created_at: string;
          driver_id: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          new_value: Json | null;
          old_value: Json | null;
          planner_user_id: string | null;
          tenant_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      audit_planning_log_2026_10: {
        Row: {
          action: string;
          created_at: string;
          driver_id: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          new_value: Json | null;
          old_value: Json | null;
          planner_user_id: string | null;
          tenant_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      audit_planning_log_2026_11: {
        Row: {
          action: string;
          created_at: string;
          driver_id: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          new_value: Json | null;
          old_value: Json | null;
          planner_user_id: string | null;
          tenant_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      audit_planning_log_2026_12: {
        Row: {
          action: string;
          created_at: string;
          driver_id: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          new_value: Json | null;
          old_value: Json | null;
          planner_user_id: string | null;
          tenant_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      audit_planning_log_2027_01: {
        Row: {
          action: string;
          created_at: string;
          driver_id: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          new_value: Json | null;
          old_value: Json | null;
          planner_user_id: string | null;
          tenant_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      audit_planning_log_2027_02: {
        Row: {
          action: string;
          created_at: string;
          driver_id: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          new_value: Json | null;
          old_value: Json | null;
          planner_user_id: string | null;
          tenant_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      audit_planning_log_2027_03: {
        Row: {
          action: string;
          created_at: string;
          driver_id: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          new_value: Json | null;
          old_value: Json | null;
          planner_user_id: string | null;
          tenant_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      audit_planning_log_2027_04: {
        Row: {
          action: string;
          created_at: string;
          driver_id: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          new_value: Json | null;
          old_value: Json | null;
          planner_user_id: string | null;
          tenant_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      audit_planning_log_2027_05: {
        Row: {
          action: string;
          created_at: string;
          driver_id: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          new_value: Json | null;
          old_value: Json | null;
          planner_user_id: string | null;
          tenant_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      audit_planning_log_2027_06: {
        Row: {
          action: string;
          created_at: string;
          driver_id: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          new_value: Json | null;
          old_value: Json | null;
          planner_user_id: string | null;
          tenant_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      audit_planning_log_2027_07: {
        Row: {
          action: string;
          created_at: string;
          driver_id: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          new_value: Json | null;
          old_value: Json | null;
          planner_user_id: string | null;
          tenant_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      audit_planning_log_2027_08: {
        Row: {
          action: string;
          created_at: string;
          driver_id: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          new_value: Json | null;
          old_value: Json | null;
          planner_user_id: string | null;
          tenant_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      audit_planning_log_2027_09: {
        Row: {
          action: string;
          created_at: string;
          driver_id: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          new_value: Json | null;
          old_value: Json | null;
          planner_user_id: string | null;
          tenant_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      audit_planning_log_2027_10: {
        Row: {
          action: string;
          created_at: string;
          driver_id: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          new_value: Json | null;
          old_value: Json | null;
          planner_user_id: string | null;
          tenant_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      audit_planning_log_2027_11: {
        Row: {
          action: string;
          created_at: string;
          driver_id: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          new_value: Json | null;
          old_value: Json | null;
          planner_user_id: string | null;
          tenant_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      audit_planning_log_2027_12: {
        Row: {
          action: string;
          created_at: string;
          driver_id: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          new_value: Json | null;
          old_value: Json | null;
          planner_user_id: string | null;
          tenant_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      audit_planning_log_default: {
        Row: {
          action: string;
          created_at: string;
          driver_id: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          new_value: Json | null;
          old_value: Json | null;
          planner_user_id: string | null;
          tenant_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          driver_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          new_value?: Json | null;
          old_value?: Json | null;
          planner_user_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      companies: {
        Row: {
          config: Json;
          created_at: string;
          id: string;
          name: string;
          plan: string;
          slug: string;
          subscription_ends_at: string | null;
          subscription_status: string;
          updated_at: string;
        };
        Insert: {
          config?: Json;
          created_at?: string;
          id?: string;
          name: string;
          plan?: string;
          slug: string;
          subscription_ends_at?: string | null;
          subscription_status?: string;
          updated_at?: string;
        };
        Update: {
          config?: Json;
          created_at?: string;
          id?: string;
          name?: string;
          plan?: string;
          slug?: string;
          subscription_ends_at?: string | null;
          subscription_status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      company_members: {
        Row: {
          avatar_url: string | null;
          company_id: string;
          created_at: string;
          email: string | null;
          id: string;
          must_set_password: boolean;
          name: string | null;
          role: string;
          user_id: string;
        };
        Insert: {
          avatar_url?: string | null;
          company_id: string;
          created_at?: string;
          email?: string | null;
          id?: string;
          must_set_password?: boolean;
          name?: string | null;
          role?: string;
          user_id: string;
        };
        Update: {
          avatar_url?: string | null;
          company_id?: string;
          created_at?: string;
          email?: string | null;
          id?: string;
          must_set_password?: boolean;
          name?: string | null;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "company_members_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      driver_availability_overrides: {
        Row: {
          available: boolean;
          created_at: string;
          date: string;
          driver_id: string;
          id: string;
          set_by: string;
          tenant_id: string;
        };
        Insert: {
          available: boolean;
          created_at?: string;
          date: string;
          driver_id: string;
          id?: string;
          set_by?: string;
          tenant_id: string;
        };
        Update: {
          available?: boolean;
          created_at?: string;
          date?: string;
          driver_id?: string;
          id?: string;
          set_by?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "driver_availability_overrides_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "driver_availability_overrides_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      driver_daily_compliance: {
        Row: {
          created_at: string;
          date: string;
          driver_id: string;
          id: string;
          max_drive_minutes: number;
          max_work_minutes: number;
          required_break_minutes: number;
          shift_end: string | null;
          shift_start: string | null;
          tenant_id: string;
        };
        Insert: {
          created_at?: string;
          date: string;
          driver_id: string;
          id?: string;
          max_drive_minutes?: number;
          max_work_minutes?: number;
          required_break_minutes?: number;
          shift_end?: string | null;
          shift_start?: string | null;
          tenant_id: string;
        };
        Update: {
          created_at?: string;
          date?: string;
          driver_id?: string;
          id?: string;
          max_drive_minutes?: number;
          max_work_minutes?: number;
          required_break_minutes?: number;
          shift_end?: string | null;
          shift_start?: string | null;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "driver_daily_compliance_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "driver_daily_compliance_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      driver_day_hours: {
        Row: {
          actual_driving_minutes: number;
          day: string;
          deadhead_minutes: number;
          drive_minutes: number;
          driver_id: string;
          id: string;
          off_minutes: number;
          other_work_minutes: number;
          shift_minutes: number;
          tachograph_approved_at: string | null;
          tachograph_approved_by: string | null;
          tachograph_drive_minutes: number | null;
          tachograph_entered_at: string | null;
          tachograph_entered_by: string | null;
          tachograph_status: string | null;
          tenant_id: string;
          updated_at: string;
          week_start: string | null;
        };
        Insert: {
          actual_driving_minutes?: number;
          day: string;
          deadhead_minutes?: number;
          drive_minutes?: number;
          driver_id: string;
          id?: string;
          off_minutes?: number;
          other_work_minutes?: number;
          shift_minutes?: number;
          tachograph_approved_at?: string | null;
          tachograph_approved_by?: string | null;
          tachograph_drive_minutes?: number | null;
          tachograph_entered_at?: string | null;
          tachograph_entered_by?: string | null;
          tachograph_status?: string | null;
          tenant_id: string;
          updated_at?: string;
          week_start?: string | null;
        };
        Update: {
          actual_driving_minutes?: number;
          day?: string;
          deadhead_minutes?: number;
          drive_minutes?: number;
          driver_id?: string;
          id?: string;
          off_minutes?: number;
          other_work_minutes?: number;
          shift_minutes?: number;
          tachograph_approved_at?: string | null;
          tachograph_approved_by?: string | null;
          tachograph_drive_minutes?: number | null;
          tachograph_entered_at?: string | null;
          tachograph_entered_by?: string | null;
          tachograph_status?: string | null;
          tenant_id?: string;
          updated_at?: string;
          week_start?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "driver_day_hours_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "driver_day_hours_tachograph_entered_by_fkey";
            columns: ["tachograph_entered_by"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "driver_day_hours_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      driver_equipment: {
        Row: {
          created_at: string;
          driver_id: string;
          equipment_type: string;
          id: string;
          tenant_id: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          driver_id: string;
          equipment_type: string;
          id?: string;
          tenant_id?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          driver_id?: string;
          equipment_type?: string;
          id?: string;
          tenant_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "driver_equipment_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "driver_equipment_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      driver_events: {
        Row: {
          driver_id: string;
          id: string;
          payload: Json;
          tenant_id: string;
          timestamp: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Insert: {
          driver_id: string;
          id?: string;
          payload?: Json;
          tenant_id: string;
          timestamp?: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Update: {
          driver_id?: string;
          id?: string;
          payload?: Json;
          tenant_id?: string;
          timestamp?: string;
          type?: Database["public"]["Enums"]["driver_event_type"];
        };
        Relationships: [
          {
            foreignKeyName: "driver_events_driver_id_fkey1";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "driver_events_tenant_id_fkey1";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      driver_events_2026_01: {
        Row: {
          driver_id: string;
          id: string;
          payload: Json;
          tenant_id: string;
          timestamp: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Insert: {
          driver_id: string;
          id?: string;
          payload?: Json;
          tenant_id: string;
          timestamp?: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Update: {
          driver_id?: string;
          id?: string;
          payload?: Json;
          tenant_id?: string;
          timestamp?: string;
          type?: Database["public"]["Enums"]["driver_event_type"];
        };
        Relationships: [];
      };
      driver_events_2026_02: {
        Row: {
          driver_id: string;
          id: string;
          payload: Json;
          tenant_id: string;
          timestamp: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Insert: {
          driver_id: string;
          id?: string;
          payload?: Json;
          tenant_id: string;
          timestamp?: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Update: {
          driver_id?: string;
          id?: string;
          payload?: Json;
          tenant_id?: string;
          timestamp?: string;
          type?: Database["public"]["Enums"]["driver_event_type"];
        };
        Relationships: [];
      };
      driver_events_2026_03: {
        Row: {
          driver_id: string;
          id: string;
          payload: Json;
          tenant_id: string;
          timestamp: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Insert: {
          driver_id: string;
          id?: string;
          payload?: Json;
          tenant_id: string;
          timestamp?: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Update: {
          driver_id?: string;
          id?: string;
          payload?: Json;
          tenant_id?: string;
          timestamp?: string;
          type?: Database["public"]["Enums"]["driver_event_type"];
        };
        Relationships: [];
      };
      driver_events_2026_04: {
        Row: {
          driver_id: string;
          id: string;
          payload: Json;
          tenant_id: string;
          timestamp: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Insert: {
          driver_id: string;
          id?: string;
          payload?: Json;
          tenant_id: string;
          timestamp?: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Update: {
          driver_id?: string;
          id?: string;
          payload?: Json;
          tenant_id?: string;
          timestamp?: string;
          type?: Database["public"]["Enums"]["driver_event_type"];
        };
        Relationships: [];
      };
      driver_events_2026_05: {
        Row: {
          driver_id: string;
          id: string;
          payload: Json;
          tenant_id: string;
          timestamp: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Insert: {
          driver_id: string;
          id?: string;
          payload?: Json;
          tenant_id: string;
          timestamp?: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Update: {
          driver_id?: string;
          id?: string;
          payload?: Json;
          tenant_id?: string;
          timestamp?: string;
          type?: Database["public"]["Enums"]["driver_event_type"];
        };
        Relationships: [];
      };
      driver_events_2026_06: {
        Row: {
          driver_id: string;
          id: string;
          payload: Json;
          tenant_id: string;
          timestamp: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Insert: {
          driver_id: string;
          id?: string;
          payload?: Json;
          tenant_id: string;
          timestamp?: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Update: {
          driver_id?: string;
          id?: string;
          payload?: Json;
          tenant_id?: string;
          timestamp?: string;
          type?: Database["public"]["Enums"]["driver_event_type"];
        };
        Relationships: [];
      };
      driver_events_2026_07: {
        Row: {
          driver_id: string;
          id: string;
          payload: Json;
          tenant_id: string;
          timestamp: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Insert: {
          driver_id: string;
          id?: string;
          payload?: Json;
          tenant_id: string;
          timestamp?: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Update: {
          driver_id?: string;
          id?: string;
          payload?: Json;
          tenant_id?: string;
          timestamp?: string;
          type?: Database["public"]["Enums"]["driver_event_type"];
        };
        Relationships: [];
      };
      driver_events_2026_08: {
        Row: {
          driver_id: string;
          id: string;
          payload: Json;
          tenant_id: string;
          timestamp: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Insert: {
          driver_id: string;
          id?: string;
          payload?: Json;
          tenant_id: string;
          timestamp?: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Update: {
          driver_id?: string;
          id?: string;
          payload?: Json;
          tenant_id?: string;
          timestamp?: string;
          type?: Database["public"]["Enums"]["driver_event_type"];
        };
        Relationships: [];
      };
      driver_events_2026_09: {
        Row: {
          driver_id: string;
          id: string;
          payload: Json;
          tenant_id: string;
          timestamp: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Insert: {
          driver_id: string;
          id?: string;
          payload?: Json;
          tenant_id: string;
          timestamp?: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Update: {
          driver_id?: string;
          id?: string;
          payload?: Json;
          tenant_id?: string;
          timestamp?: string;
          type?: Database["public"]["Enums"]["driver_event_type"];
        };
        Relationships: [];
      };
      driver_events_2026_10: {
        Row: {
          driver_id: string;
          id: string;
          payload: Json;
          tenant_id: string;
          timestamp: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Insert: {
          driver_id: string;
          id?: string;
          payload?: Json;
          tenant_id: string;
          timestamp?: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Update: {
          driver_id?: string;
          id?: string;
          payload?: Json;
          tenant_id?: string;
          timestamp?: string;
          type?: Database["public"]["Enums"]["driver_event_type"];
        };
        Relationships: [];
      };
      driver_events_2026_11: {
        Row: {
          driver_id: string;
          id: string;
          payload: Json;
          tenant_id: string;
          timestamp: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Insert: {
          driver_id: string;
          id?: string;
          payload?: Json;
          tenant_id: string;
          timestamp?: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Update: {
          driver_id?: string;
          id?: string;
          payload?: Json;
          tenant_id?: string;
          timestamp?: string;
          type?: Database["public"]["Enums"]["driver_event_type"];
        };
        Relationships: [];
      };
      driver_events_2026_12: {
        Row: {
          driver_id: string;
          id: string;
          payload: Json;
          tenant_id: string;
          timestamp: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Insert: {
          driver_id: string;
          id?: string;
          payload?: Json;
          tenant_id: string;
          timestamp?: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Update: {
          driver_id?: string;
          id?: string;
          payload?: Json;
          tenant_id?: string;
          timestamp?: string;
          type?: Database["public"]["Enums"]["driver_event_type"];
        };
        Relationships: [];
      };
      driver_events_2027_01: {
        Row: {
          driver_id: string;
          id: string;
          payload: Json;
          tenant_id: string;
          timestamp: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Insert: {
          driver_id: string;
          id?: string;
          payload?: Json;
          tenant_id: string;
          timestamp?: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Update: {
          driver_id?: string;
          id?: string;
          payload?: Json;
          tenant_id?: string;
          timestamp?: string;
          type?: Database["public"]["Enums"]["driver_event_type"];
        };
        Relationships: [];
      };
      driver_events_2027_02: {
        Row: {
          driver_id: string;
          id: string;
          payload: Json;
          tenant_id: string;
          timestamp: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Insert: {
          driver_id: string;
          id?: string;
          payload?: Json;
          tenant_id: string;
          timestamp?: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Update: {
          driver_id?: string;
          id?: string;
          payload?: Json;
          tenant_id?: string;
          timestamp?: string;
          type?: Database["public"]["Enums"]["driver_event_type"];
        };
        Relationships: [];
      };
      driver_events_2027_03: {
        Row: {
          driver_id: string;
          id: string;
          payload: Json;
          tenant_id: string;
          timestamp: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Insert: {
          driver_id: string;
          id?: string;
          payload?: Json;
          tenant_id: string;
          timestamp?: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Update: {
          driver_id?: string;
          id?: string;
          payload?: Json;
          tenant_id?: string;
          timestamp?: string;
          type?: Database["public"]["Enums"]["driver_event_type"];
        };
        Relationships: [];
      };
      driver_events_2027_04: {
        Row: {
          driver_id: string;
          id: string;
          payload: Json;
          tenant_id: string;
          timestamp: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Insert: {
          driver_id: string;
          id?: string;
          payload?: Json;
          tenant_id: string;
          timestamp?: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Update: {
          driver_id?: string;
          id?: string;
          payload?: Json;
          tenant_id?: string;
          timestamp?: string;
          type?: Database["public"]["Enums"]["driver_event_type"];
        };
        Relationships: [];
      };
      driver_events_2027_05: {
        Row: {
          driver_id: string;
          id: string;
          payload: Json;
          tenant_id: string;
          timestamp: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Insert: {
          driver_id: string;
          id?: string;
          payload?: Json;
          tenant_id: string;
          timestamp?: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Update: {
          driver_id?: string;
          id?: string;
          payload?: Json;
          tenant_id?: string;
          timestamp?: string;
          type?: Database["public"]["Enums"]["driver_event_type"];
        };
        Relationships: [];
      };
      driver_events_2027_06: {
        Row: {
          driver_id: string;
          id: string;
          payload: Json;
          tenant_id: string;
          timestamp: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Insert: {
          driver_id: string;
          id?: string;
          payload?: Json;
          tenant_id: string;
          timestamp?: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Update: {
          driver_id?: string;
          id?: string;
          payload?: Json;
          tenant_id?: string;
          timestamp?: string;
          type?: Database["public"]["Enums"]["driver_event_type"];
        };
        Relationships: [];
      };
      driver_events_2027_07: {
        Row: {
          driver_id: string;
          id: string;
          payload: Json;
          tenant_id: string;
          timestamp: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Insert: {
          driver_id: string;
          id?: string;
          payload?: Json;
          tenant_id: string;
          timestamp?: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Update: {
          driver_id?: string;
          id?: string;
          payload?: Json;
          tenant_id?: string;
          timestamp?: string;
          type?: Database["public"]["Enums"]["driver_event_type"];
        };
        Relationships: [];
      };
      driver_events_2027_08: {
        Row: {
          driver_id: string;
          id: string;
          payload: Json;
          tenant_id: string;
          timestamp: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Insert: {
          driver_id: string;
          id?: string;
          payload?: Json;
          tenant_id: string;
          timestamp?: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Update: {
          driver_id?: string;
          id?: string;
          payload?: Json;
          tenant_id?: string;
          timestamp?: string;
          type?: Database["public"]["Enums"]["driver_event_type"];
        };
        Relationships: [];
      };
      driver_events_2027_09: {
        Row: {
          driver_id: string;
          id: string;
          payload: Json;
          tenant_id: string;
          timestamp: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Insert: {
          driver_id: string;
          id?: string;
          payload?: Json;
          tenant_id: string;
          timestamp?: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Update: {
          driver_id?: string;
          id?: string;
          payload?: Json;
          tenant_id?: string;
          timestamp?: string;
          type?: Database["public"]["Enums"]["driver_event_type"];
        };
        Relationships: [];
      };
      driver_events_2027_10: {
        Row: {
          driver_id: string;
          id: string;
          payload: Json;
          tenant_id: string;
          timestamp: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Insert: {
          driver_id: string;
          id?: string;
          payload?: Json;
          tenant_id: string;
          timestamp?: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Update: {
          driver_id?: string;
          id?: string;
          payload?: Json;
          tenant_id?: string;
          timestamp?: string;
          type?: Database["public"]["Enums"]["driver_event_type"];
        };
        Relationships: [];
      };
      driver_events_2027_11: {
        Row: {
          driver_id: string;
          id: string;
          payload: Json;
          tenant_id: string;
          timestamp: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Insert: {
          driver_id: string;
          id?: string;
          payload?: Json;
          tenant_id: string;
          timestamp?: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Update: {
          driver_id?: string;
          id?: string;
          payload?: Json;
          tenant_id?: string;
          timestamp?: string;
          type?: Database["public"]["Enums"]["driver_event_type"];
        };
        Relationships: [];
      };
      driver_events_2027_12: {
        Row: {
          driver_id: string;
          id: string;
          payload: Json;
          tenant_id: string;
          timestamp: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Insert: {
          driver_id: string;
          id?: string;
          payload?: Json;
          tenant_id: string;
          timestamp?: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Update: {
          driver_id?: string;
          id?: string;
          payload?: Json;
          tenant_id?: string;
          timestamp?: string;
          type?: Database["public"]["Enums"]["driver_event_type"];
        };
        Relationships: [];
      };
      driver_events_default: {
        Row: {
          driver_id: string;
          id: string;
          payload: Json;
          tenant_id: string;
          timestamp: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Insert: {
          driver_id: string;
          id?: string;
          payload?: Json;
          tenant_id: string;
          timestamp?: string;
          type: Database["public"]["Enums"]["driver_event_type"];
        };
        Update: {
          driver_id?: string;
          id?: string;
          payload?: Json;
          tenant_id?: string;
          timestamp?: string;
          type?: Database["public"]["Enums"]["driver_event_type"];
        };
        Relationships: [];
      };
      driver_positions: {
        Row: {
          accuracy: number | null;
          bearing: number | null;
          created_at: string;
          driver_id: string;
          id: string;
          lat: number;
          lon: number;
          speed: number | null;
          tenant_id: string;
        };
        Insert: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id: string;
          id?: string;
          lat: number;
          lon: number;
          speed?: number | null;
          tenant_id: string;
        };
        Update: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          lat?: number;
          lon?: number;
          speed?: number | null;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "driver_positions_driver_id_fkey1";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "driver_positions_tenant_id_fkey1";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      driver_positions_2026_01: {
        Row: {
          accuracy: number | null;
          bearing: number | null;
          created_at: string;
          driver_id: string;
          id: string;
          lat: number;
          lon: number;
          speed: number | null;
          tenant_id: string;
        };
        Insert: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id: string;
          id?: string;
          lat: number;
          lon: number;
          speed?: number | null;
          tenant_id: string;
        };
        Update: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          lat?: number;
          lon?: number;
          speed?: number | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      driver_positions_2026_02: {
        Row: {
          accuracy: number | null;
          bearing: number | null;
          created_at: string;
          driver_id: string;
          id: string;
          lat: number;
          lon: number;
          speed: number | null;
          tenant_id: string;
        };
        Insert: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id: string;
          id?: string;
          lat: number;
          lon: number;
          speed?: number | null;
          tenant_id: string;
        };
        Update: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          lat?: number;
          lon?: number;
          speed?: number | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      driver_positions_2026_03: {
        Row: {
          accuracy: number | null;
          bearing: number | null;
          created_at: string;
          driver_id: string;
          id: string;
          lat: number;
          lon: number;
          speed: number | null;
          tenant_id: string;
        };
        Insert: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id: string;
          id?: string;
          lat: number;
          lon: number;
          speed?: number | null;
          tenant_id: string;
        };
        Update: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          lat?: number;
          lon?: number;
          speed?: number | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      driver_positions_2026_04: {
        Row: {
          accuracy: number | null;
          bearing: number | null;
          created_at: string;
          driver_id: string;
          id: string;
          lat: number;
          lon: number;
          speed: number | null;
          tenant_id: string;
        };
        Insert: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id: string;
          id?: string;
          lat: number;
          lon: number;
          speed?: number | null;
          tenant_id: string;
        };
        Update: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          lat?: number;
          lon?: number;
          speed?: number | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      driver_positions_2026_05: {
        Row: {
          accuracy: number | null;
          bearing: number | null;
          created_at: string;
          driver_id: string;
          id: string;
          lat: number;
          lon: number;
          speed: number | null;
          tenant_id: string;
        };
        Insert: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id: string;
          id?: string;
          lat: number;
          lon: number;
          speed?: number | null;
          tenant_id: string;
        };
        Update: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          lat?: number;
          lon?: number;
          speed?: number | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      driver_positions_2026_06: {
        Row: {
          accuracy: number | null;
          bearing: number | null;
          created_at: string;
          driver_id: string;
          id: string;
          lat: number;
          lon: number;
          speed: number | null;
          tenant_id: string;
        };
        Insert: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id: string;
          id?: string;
          lat: number;
          lon: number;
          speed?: number | null;
          tenant_id: string;
        };
        Update: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          lat?: number;
          lon?: number;
          speed?: number | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      driver_positions_2026_07: {
        Row: {
          accuracy: number | null;
          bearing: number | null;
          created_at: string;
          driver_id: string;
          id: string;
          lat: number;
          lon: number;
          speed: number | null;
          tenant_id: string;
        };
        Insert: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id: string;
          id?: string;
          lat: number;
          lon: number;
          speed?: number | null;
          tenant_id: string;
        };
        Update: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          lat?: number;
          lon?: number;
          speed?: number | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      driver_positions_2026_08: {
        Row: {
          accuracy: number | null;
          bearing: number | null;
          created_at: string;
          driver_id: string;
          id: string;
          lat: number;
          lon: number;
          speed: number | null;
          tenant_id: string;
        };
        Insert: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id: string;
          id?: string;
          lat: number;
          lon: number;
          speed?: number | null;
          tenant_id: string;
        };
        Update: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          lat?: number;
          lon?: number;
          speed?: number | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      driver_positions_2026_09: {
        Row: {
          accuracy: number | null;
          bearing: number | null;
          created_at: string;
          driver_id: string;
          id: string;
          lat: number;
          lon: number;
          speed: number | null;
          tenant_id: string;
        };
        Insert: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id: string;
          id?: string;
          lat: number;
          lon: number;
          speed?: number | null;
          tenant_id: string;
        };
        Update: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          lat?: number;
          lon?: number;
          speed?: number | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      driver_positions_2026_10: {
        Row: {
          accuracy: number | null;
          bearing: number | null;
          created_at: string;
          driver_id: string;
          id: string;
          lat: number;
          lon: number;
          speed: number | null;
          tenant_id: string;
        };
        Insert: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id: string;
          id?: string;
          lat: number;
          lon: number;
          speed?: number | null;
          tenant_id: string;
        };
        Update: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          lat?: number;
          lon?: number;
          speed?: number | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      driver_positions_2026_11: {
        Row: {
          accuracy: number | null;
          bearing: number | null;
          created_at: string;
          driver_id: string;
          id: string;
          lat: number;
          lon: number;
          speed: number | null;
          tenant_id: string;
        };
        Insert: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id: string;
          id?: string;
          lat: number;
          lon: number;
          speed?: number | null;
          tenant_id: string;
        };
        Update: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          lat?: number;
          lon?: number;
          speed?: number | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      driver_positions_2026_12: {
        Row: {
          accuracy: number | null;
          bearing: number | null;
          created_at: string;
          driver_id: string;
          id: string;
          lat: number;
          lon: number;
          speed: number | null;
          tenant_id: string;
        };
        Insert: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id: string;
          id?: string;
          lat: number;
          lon: number;
          speed?: number | null;
          tenant_id: string;
        };
        Update: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          lat?: number;
          lon?: number;
          speed?: number | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      driver_positions_2027_01: {
        Row: {
          accuracy: number | null;
          bearing: number | null;
          created_at: string;
          driver_id: string;
          id: string;
          lat: number;
          lon: number;
          speed: number | null;
          tenant_id: string;
        };
        Insert: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id: string;
          id?: string;
          lat: number;
          lon: number;
          speed?: number | null;
          tenant_id: string;
        };
        Update: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          lat?: number;
          lon?: number;
          speed?: number | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      driver_positions_2027_02: {
        Row: {
          accuracy: number | null;
          bearing: number | null;
          created_at: string;
          driver_id: string;
          id: string;
          lat: number;
          lon: number;
          speed: number | null;
          tenant_id: string;
        };
        Insert: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id: string;
          id?: string;
          lat: number;
          lon: number;
          speed?: number | null;
          tenant_id: string;
        };
        Update: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          lat?: number;
          lon?: number;
          speed?: number | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      driver_positions_2027_03: {
        Row: {
          accuracy: number | null;
          bearing: number | null;
          created_at: string;
          driver_id: string;
          id: string;
          lat: number;
          lon: number;
          speed: number | null;
          tenant_id: string;
        };
        Insert: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id: string;
          id?: string;
          lat: number;
          lon: number;
          speed?: number | null;
          tenant_id: string;
        };
        Update: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          lat?: number;
          lon?: number;
          speed?: number | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      driver_positions_2027_04: {
        Row: {
          accuracy: number | null;
          bearing: number | null;
          created_at: string;
          driver_id: string;
          id: string;
          lat: number;
          lon: number;
          speed: number | null;
          tenant_id: string;
        };
        Insert: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id: string;
          id?: string;
          lat: number;
          lon: number;
          speed?: number | null;
          tenant_id: string;
        };
        Update: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          lat?: number;
          lon?: number;
          speed?: number | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      driver_positions_2027_05: {
        Row: {
          accuracy: number | null;
          bearing: number | null;
          created_at: string;
          driver_id: string;
          id: string;
          lat: number;
          lon: number;
          speed: number | null;
          tenant_id: string;
        };
        Insert: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id: string;
          id?: string;
          lat: number;
          lon: number;
          speed?: number | null;
          tenant_id: string;
        };
        Update: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          lat?: number;
          lon?: number;
          speed?: number | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      driver_positions_2027_06: {
        Row: {
          accuracy: number | null;
          bearing: number | null;
          created_at: string;
          driver_id: string;
          id: string;
          lat: number;
          lon: number;
          speed: number | null;
          tenant_id: string;
        };
        Insert: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id: string;
          id?: string;
          lat: number;
          lon: number;
          speed?: number | null;
          tenant_id: string;
        };
        Update: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          lat?: number;
          lon?: number;
          speed?: number | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      driver_positions_2027_07: {
        Row: {
          accuracy: number | null;
          bearing: number | null;
          created_at: string;
          driver_id: string;
          id: string;
          lat: number;
          lon: number;
          speed: number | null;
          tenant_id: string;
        };
        Insert: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id: string;
          id?: string;
          lat: number;
          lon: number;
          speed?: number | null;
          tenant_id: string;
        };
        Update: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          lat?: number;
          lon?: number;
          speed?: number | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      driver_positions_2027_08: {
        Row: {
          accuracy: number | null;
          bearing: number | null;
          created_at: string;
          driver_id: string;
          id: string;
          lat: number;
          lon: number;
          speed: number | null;
          tenant_id: string;
        };
        Insert: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id: string;
          id?: string;
          lat: number;
          lon: number;
          speed?: number | null;
          tenant_id: string;
        };
        Update: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          lat?: number;
          lon?: number;
          speed?: number | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      driver_positions_2027_09: {
        Row: {
          accuracy: number | null;
          bearing: number | null;
          created_at: string;
          driver_id: string;
          id: string;
          lat: number;
          lon: number;
          speed: number | null;
          tenant_id: string;
        };
        Insert: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id: string;
          id?: string;
          lat: number;
          lon: number;
          speed?: number | null;
          tenant_id: string;
        };
        Update: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          lat?: number;
          lon?: number;
          speed?: number | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      driver_positions_2027_10: {
        Row: {
          accuracy: number | null;
          bearing: number | null;
          created_at: string;
          driver_id: string;
          id: string;
          lat: number;
          lon: number;
          speed: number | null;
          tenant_id: string;
        };
        Insert: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id: string;
          id?: string;
          lat: number;
          lon: number;
          speed?: number | null;
          tenant_id: string;
        };
        Update: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          lat?: number;
          lon?: number;
          speed?: number | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      driver_positions_2027_11: {
        Row: {
          accuracy: number | null;
          bearing: number | null;
          created_at: string;
          driver_id: string;
          id: string;
          lat: number;
          lon: number;
          speed: number | null;
          tenant_id: string;
        };
        Insert: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id: string;
          id?: string;
          lat: number;
          lon: number;
          speed?: number | null;
          tenant_id: string;
        };
        Update: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          lat?: number;
          lon?: number;
          speed?: number | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      driver_positions_2027_12: {
        Row: {
          accuracy: number | null;
          bearing: number | null;
          created_at: string;
          driver_id: string;
          id: string;
          lat: number;
          lon: number;
          speed: number | null;
          tenant_id: string;
        };
        Insert: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id: string;
          id?: string;
          lat: number;
          lon: number;
          speed?: number | null;
          tenant_id: string;
        };
        Update: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          lat?: number;
          lon?: number;
          speed?: number | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      driver_positions_default: {
        Row: {
          accuracy: number | null;
          bearing: number | null;
          created_at: string;
          driver_id: string;
          id: string;
          lat: number;
          lon: number;
          speed: number | null;
          tenant_id: string;
        };
        Insert: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id: string;
          id?: string;
          lat: number;
          lon: number;
          speed?: number | null;
          tenant_id: string;
        };
        Update: {
          accuracy?: number | null;
          bearing?: number | null;
          created_at?: string;
          driver_id?: string;
          id?: string;
          lat?: number;
          lon?: number;
          speed?: number | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      driver_push_subscriptions: {
        Row: {
          auth: string;
          driver_id: string;
          endpoint: string;
          p256dh: string;
          updated_at: string;
        };
        Insert: {
          auth: string;
          driver_id: string;
          endpoint: string;
          p256dh: string;
          updated_at?: string;
        };
        Update: {
          auth?: string;
          driver_id?: string;
          endpoint?: string;
          p256dh?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "driver_push_subscriptions_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: true;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
        ];
      };
      driver_registrations: {
        Row: {
          created_at: string;
          driver_id: string | null;
          id: string;
          name: string | null;
          phone: string | null;
          status: Database["public"]["Enums"]["registration_status"];
          telegram_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          driver_id?: string | null;
          id?: string;
          name?: string | null;
          phone?: string | null;
          status?: Database["public"]["Enums"]["registration_status"];
          telegram_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          driver_id?: string | null;
          id?: string;
          name?: string | null;
          phone?: string | null;
          status?: Database["public"]["Enums"]["registration_status"];
          telegram_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "driver_registrations_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
        ];
      };
      driver_shift_templates: {
        Row: {
          created_at: string;
          day_of_week: number;
          driver_id: string;
          end_time: string | null;
          id: string;
          is_primary: boolean;
          start_time: string | null;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          day_of_week: number;
          driver_id: string;
          end_time?: string | null;
          id?: string;
          is_primary?: boolean;
          start_time?: string | null;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          day_of_week?: number;
          driver_id?: string;
          end_time?: string | null;
          id?: string;
          is_primary?: boolean;
          start_time?: string | null;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "driver_shift_templates_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "driver_shift_templates_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      driver_week_hours: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          driver_id: string;
          entered_at: string;
          entered_by: string | null;
          id: string;
          status: string;
          tacho_drive_minutes: number;
          tenant_id: string | null;
          week_start: string;
        };
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          driver_id: string;
          entered_at?: string;
          entered_by?: string | null;
          id?: string;
          status: string;
          tacho_drive_minutes: number;
          tenant_id?: string | null;
          week_start: string;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          driver_id?: string;
          entered_at?: string;
          entered_by?: string | null;
          id?: string;
          status?: string;
          tacho_drive_minutes?: number;
          tenant_id?: string | null;
          week_start?: string;
        };
        Relationships: [
          {
            foreignKeyName: "driver_week_hours_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "driver_week_hours_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      drivers: {
        Row: {
          created_at: string;
          current_lat: number | null;
          current_lon: number | null;
          deleted_at: string | null;
          home_warehouse_id: string | null;
          id: string;
          last_update_time: string | null;
          login_code: string | null;
          name: string;
          pairing_code: string | null;
          pairing_expires_at: string | null;
          phone: string | null;
          return_to_base_required: boolean;
          status: Database["public"]["Enums"]["driver_status"];
          telegram_id: string | null;
          tenant_id: string;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          current_lat?: number | null;
          current_lon?: number | null;
          deleted_at?: string | null;
          home_warehouse_id?: string | null;
          id?: string;
          last_update_time?: string | null;
          login_code?: string | null;
          name: string;
          pairing_code?: string | null;
          pairing_expires_at?: string | null;
          phone?: string | null;
          return_to_base_required?: boolean;
          status?: Database["public"]["Enums"]["driver_status"];
          telegram_id?: string | null;
          tenant_id: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          current_lat?: number | null;
          current_lon?: number | null;
          deleted_at?: string | null;
          home_warehouse_id?: string | null;
          id?: string;
          last_update_time?: string | null;
          login_code?: string | null;
          name?: string;
          pairing_code?: string | null;
          pairing_expires_at?: string | null;
          phone?: string | null;
          return_to_base_required?: boolean;
          status?: Database["public"]["Enums"]["driver_status"];
          telegram_id?: string | null;
          tenant_id?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "drivers_home_warehouse_id_fkey";
            columns: ["home_warehouse_id"];
            isOneToOne: false;
            referencedRelation: "warehouses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "drivers_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      driving_legs: {
        Row: {
          arrived_at: string | null;
          created_at: string;
          departed_at: string | null;
          distance_km: number | null;
          driver_id: string;
          driving_minutes: number | null;
          from_label: string | null;
          from_lat: number | null;
          from_lon: number | null;
          from_warehouse_id: string | null;
          id: string;
          job_id: string | null;
          leg_date: string;
          planned_minutes: number | null;
          source: string;
          tenant_id: string;
          to_label: string | null;
          to_lat: number | null;
          to_lon: number | null;
          to_warehouse_id: string | null;
        };
        Insert: {
          arrived_at?: string | null;
          created_at?: string;
          departed_at?: string | null;
          distance_km?: number | null;
          driver_id: string;
          driving_minutes?: number | null;
          from_label?: string | null;
          from_lat?: number | null;
          from_lon?: number | null;
          from_warehouse_id?: string | null;
          id?: string;
          job_id?: string | null;
          leg_date: string;
          planned_minutes?: number | null;
          source?: string;
          tenant_id: string;
          to_label?: string | null;
          to_lat?: number | null;
          to_lon?: number | null;
          to_warehouse_id?: string | null;
        };
        Update: {
          arrived_at?: string | null;
          created_at?: string;
          departed_at?: string | null;
          distance_km?: number | null;
          driver_id?: string;
          driving_minutes?: number | null;
          from_label?: string | null;
          from_lat?: number | null;
          from_lon?: number | null;
          from_warehouse_id?: string | null;
          id?: string;
          job_id?: string | null;
          leg_date?: string;
          planned_minutes?: number | null;
          source?: string;
          tenant_id?: string;
          to_label?: string | null;
          to_lat?: number | null;
          to_lon?: number | null;
          to_warehouse_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "driving_legs_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "driving_legs_from_warehouse_id_fkey";
            columns: ["from_warehouse_id"];
            isOneToOne: false;
            referencedRelation: "warehouses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "driving_legs_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "driving_legs_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "driving_legs_to_warehouse_id_fkey";
            columns: ["to_warehouse_id"];
            isOneToOne: false;
            referencedRelation: "warehouses";
            referencedColumns: ["id"];
          },
        ];
      };
      import_batches: {
        Row: {
          created_at: string;
          created_count: number;
          csv_rows: Json;
          duplicate_count: number;
          error_count: number;
          expires_at: string;
          file_name: string;
          id: string;
          parked_count: number;
          row_count: number;
          tenant_id: string;
        };
        Insert: {
          created_at?: string;
          created_count?: number;
          csv_rows?: Json;
          duplicate_count?: number;
          error_count?: number;
          expires_at?: string;
          file_name: string;
          id?: string;
          parked_count?: number;
          row_count?: number;
          tenant_id: string;
        };
        Update: {
          created_at?: string;
          created_count?: number;
          csv_rows?: Json;
          duplicate_count?: number;
          error_count?: number;
          expires_at?: string;
          file_name?: string;
          id?: string;
          parked_count?: number;
          row_count?: number;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "import_batches_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      import_rows: {
        Row: {
          batch_id: string;
          created_at: string;
          data: Json;
          id: string;
          outcome: string | null;
          outcome_note: string | null;
          row_index: number;
          tenant_id: string;
        };
        Insert: {
          batch_id: string;
          created_at?: string;
          data: Json;
          id?: string;
          outcome?: string | null;
          outcome_note?: string | null;
          row_index: number;
          tenant_id: string;
        };
        Update: {
          batch_id?: string;
          created_at?: string;
          data?: Json;
          id?: string;
          outcome?: string | null;
          outcome_note?: string | null;
          row_index?: number;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "import_rows_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "import_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "import_rows_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      job_stops: {
        Row: {
          arrived_at: string | null;
          created_at: string;
          departed_at: string | null;
          id: string;
          job_id: string;
          kind: Database["public"]["Enums"]["stop_kind"];
          scheduled_at: string | null;
          seq: number;
          tenant_id: string;
          warehouse_id: string;
          yard_departure: string | null;
        };
        Insert: {
          arrived_at?: string | null;
          created_at?: string;
          departed_at?: string | null;
          id?: string;
          job_id: string;
          kind: Database["public"]["Enums"]["stop_kind"];
          scheduled_at?: string | null;
          seq: number;
          tenant_id: string;
          warehouse_id: string;
          yard_departure?: string | null;
        };
        Update: {
          arrived_at?: string | null;
          created_at?: string;
          departed_at?: string | null;
          id?: string;
          job_id?: string;
          kind?: Database["public"]["Enums"]["stop_kind"];
          scheduled_at?: string | null;
          seq?: number;
          tenant_id?: string;
          warehouse_id?: string;
          yard_departure?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "job_stops_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_stops_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_stops_warehouse_id_fkey";
            columns: ["warehouse_id"];
            isOneToOne: false;
            referencedRelation: "warehouses";
            referencedColumns: ["id"];
          },
        ];
      };
      jobs: {
        Row: {
          assigned_driver_id: string | null;
          created_at: string;
          deleted_at: string | null;
          destination_warehouse_id: string | null;
          earliest_start: string | null;
          equipment_type: string | null;
          estimated_cost: string | null;
          eta_minutes: number | null;
          for_date: string | null;
          handling_minutes: number | null;
          id: string;
          import_batch_id: string | null;
          latest_end: string | null;
          manual_override: boolean;
          origin_warehouse_id: string | null;
          planned_driver_id: string | null;
          planned_sequence: number | null;
          planned_start_at: string | null;
          reference: string;
          scheduled_at: string | null;
          status: Database["public"]["Enums"]["job_status"];
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          assigned_driver_id?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          destination_warehouse_id?: string | null;
          earliest_start?: string | null;
          equipment_type?: string | null;
          estimated_cost?: string | null;
          eta_minutes?: number | null;
          for_date?: string | null;
          handling_minutes?: number | null;
          id?: string;
          import_batch_id?: string | null;
          latest_end?: string | null;
          manual_override?: boolean;
          origin_warehouse_id?: string | null;
          planned_driver_id?: string | null;
          planned_sequence?: number | null;
          planned_start_at?: string | null;
          reference?: string;
          scheduled_at?: string | null;
          status?: Database["public"]["Enums"]["job_status"];
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          assigned_driver_id?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          destination_warehouse_id?: string | null;
          earliest_start?: string | null;
          equipment_type?: string | null;
          estimated_cost?: string | null;
          eta_minutes?: number | null;
          for_date?: string | null;
          handling_minutes?: number | null;
          id?: string;
          import_batch_id?: string | null;
          latest_end?: string | null;
          manual_override?: boolean;
          origin_warehouse_id?: string | null;
          planned_driver_id?: string | null;
          planned_sequence?: number | null;
          planned_start_at?: string | null;
          reference?: string;
          scheduled_at?: string | null;
          status?: Database["public"]["Enums"]["job_status"];
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "jobs_assigned_driver_id_fkey";
            columns: ["assigned_driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_destination_warehouse_id_fkey";
            columns: ["destination_warehouse_id"];
            isOneToOne: false;
            referencedRelation: "warehouses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_import_batch_id_fkey";
            columns: ["import_batch_id"];
            isOneToOne: false;
            referencedRelation: "import_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_origin_warehouse_id_fkey";
            columns: ["origin_warehouse_id"];
            isOneToOne: false;
            referencedRelation: "warehouses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_planned_driver_id_fkey";
            columns: ["planned_driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      lane_travel_times: {
        Row: {
          avg_duration_minutes: number | null;
          day_of_week: number;
          from_warehouse_id: string;
          hour_of_day: number;
          id: string;
          last_updated: string;
          p50_duration_minutes: number | null;
          p90_duration_minutes: number | null;
          sample_count: number;
          tenant_id: string | null;
          to_warehouse_id: string;
        };
        Insert: {
          avg_duration_minutes?: number | null;
          day_of_week: number;
          from_warehouse_id: string;
          hour_of_day: number;
          id?: string;
          last_updated?: string;
          p50_duration_minutes?: number | null;
          p90_duration_minutes?: number | null;
          sample_count?: number;
          tenant_id?: string | null;
          to_warehouse_id: string;
        };
        Update: {
          avg_duration_minutes?: number | null;
          day_of_week?: number;
          from_warehouse_id?: string;
          hour_of_day?: number;
          id?: string;
          last_updated?: string;
          p50_duration_minutes?: number | null;
          p90_duration_minutes?: number | null;
          sample_count?: number;
          tenant_id?: string | null;
          to_warehouse_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lane_travel_times_from_warehouse_id_fkey";
            columns: ["from_warehouse_id"];
            isOneToOne: false;
            referencedRelation: "warehouses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lane_travel_times_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lane_travel_times_to_warehouse_id_fkey";
            columns: ["to_warehouse_id"];
            isOneToOne: false;
            referencedRelation: "warehouses";
            referencedColumns: ["id"];
          },
        ];
      };
      pending_import_stops: {
        Row: {
          created_at: string;
          id: string;
          kind: string | null;
          pending_import_id: string;
          scheduled_at: string | null;
          stop_index: number;
          tenant_id: string;
          warehouse_code: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          kind?: string | null;
          pending_import_id: string;
          scheduled_at?: string | null;
          stop_index: number;
          tenant_id: string;
          warehouse_code?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          kind?: string | null;
          pending_import_id?: string;
          scheduled_at?: string | null;
          stop_index?: number;
          tenant_id?: string;
          warehouse_code?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "pending_import_stops_pending_import_id_fkey";
            columns: ["pending_import_id"];
            isOneToOne: false;
            referencedRelation: "pending_job_imports";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pending_import_stops_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      pending_job_imports: {
        Row: {
          created_at: string;
          equipment_type: string | null;
          id: string;
          import_batch_id: string | null;
          lane: string;
          missing_codes: string[];
          reference: string;
          stop_scheduled_at: string[];
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          equipment_type?: string | null;
          id?: string;
          import_batch_id?: string | null;
          lane: string;
          missing_codes?: string[];
          reference: string;
          stop_scheduled_at?: string[];
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          equipment_type?: string | null;
          id?: string;
          import_batch_id?: string | null;
          lane?: string;
          missing_codes?: string[];
          reference?: string;
          stop_scheduled_at?: string[];
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pending_job_imports_import_batch_id_fkey";
            columns: ["import_batch_id"];
            isOneToOne: false;
            referencedRelation: "import_batches";
            referencedColumns: ["id"];
          },
        ];
      };
      planning_queue: {
        Row: {
          attempts: number;
          enqueued_at: string;
          event_type: string;
          id: number;
          last_error: string | null;
          payload: Json;
          priority: number;
          processed_at: string | null;
          processing_at: string | null;
          tenant_id: string | null;
          worker_id: string | null;
        };
        Insert: {
          attempts?: number;
          enqueued_at?: string;
          event_type: string;
          id?: number;
          last_error?: string | null;
          payload?: Json;
          priority?: number;
          processed_at?: string | null;
          processing_at?: string | null;
          tenant_id?: string | null;
          worker_id?: string | null;
        };
        Update: {
          attempts?: number;
          enqueued_at?: string;
          event_type?: string;
          id?: number;
          last_error?: string | null;
          payload?: Json;
          priority?: number;
          processed_at?: string | null;
          processing_at?: string | null;
          tenant_id?: string | null;
          worker_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "planning_queue_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      reimport_alerts: {
        Row: {
          id: string;
          lane: string;
          reference: string;
          tenant_id: string;
          uploaded_at: string;
        };
        Insert: {
          id?: string;
          lane: string;
          reference: string;
          tenant_id: string;
          uploaded_at?: string;
        };
        Update: {
          id?: string;
          lane?: string;
          reference?: string;
          tenant_id?: string;
          uploaded_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reimport_alerts_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      route_jobs: {
        Row: {
          actual_arrival: string | null;
          actual_departure: string | null;
          created_at: string;
          deadhead_from_warehouse_id: string | null;
          deadhead_km: number | null;
          deadhead_minutes: number | null;
          deadhead_to_warehouse_id: string | null;
          id: string;
          is_deadhead: boolean;
          job_id: string | null;
          planned_arrival: string | null;
          planned_departure: string | null;
          route_id: string;
          stop_sequence: number;
          tenant_id: string;
        };
        Insert: {
          actual_arrival?: string | null;
          actual_departure?: string | null;
          created_at?: string;
          deadhead_from_warehouse_id?: string | null;
          deadhead_km?: number | null;
          deadhead_minutes?: number | null;
          deadhead_to_warehouse_id?: string | null;
          id?: string;
          is_deadhead?: boolean;
          job_id?: string | null;
          planned_arrival?: string | null;
          planned_departure?: string | null;
          route_id: string;
          stop_sequence: number;
          tenant_id: string;
        };
        Update: {
          actual_arrival?: string | null;
          actual_departure?: string | null;
          created_at?: string;
          deadhead_from_warehouse_id?: string | null;
          deadhead_km?: number | null;
          deadhead_minutes?: number | null;
          deadhead_to_warehouse_id?: string | null;
          id?: string;
          is_deadhead?: boolean;
          job_id?: string | null;
          planned_arrival?: string | null;
          planned_departure?: string | null;
          route_id?: string;
          stop_sequence?: number;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "route_jobs_deadhead_from_warehouse_id_fkey";
            columns: ["deadhead_from_warehouse_id"];
            isOneToOne: false;
            referencedRelation: "warehouses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "route_jobs_deadhead_to_warehouse_id_fkey";
            columns: ["deadhead_to_warehouse_id"];
            isOneToOne: false;
            referencedRelation: "warehouses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "route_jobs_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "route_jobs_route_id_fkey";
            columns: ["route_id"];
            isOneToOne: false;
            referencedRelation: "routes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "route_jobs_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      route_notes: {
        Row: {
          author_avatar_url: string | null;
          author_email: string | null;
          author_name: string | null;
          author_user_id: string | null;
          body: string;
          created_at: string;
          id: string;
          job_id: string;
          tenant_id: string | null;
        };
        Insert: {
          author_avatar_url?: string | null;
          author_email?: string | null;
          author_name?: string | null;
          author_user_id?: string | null;
          body: string;
          created_at?: string;
          id?: string;
          job_id: string;
          tenant_id?: string | null;
        };
        Update: {
          author_avatar_url?: string | null;
          author_email?: string | null;
          author_name?: string | null;
          author_user_id?: string | null;
          body?: string;
          created_at?: string;
          id?: string;
          job_id?: string;
          tenant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "route_notes_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      routes: {
        Row: {
          actual_end_at: string | null;
          actual_start_at: string | null;
          created_at: string;
          deleted_at: string | null;
          driver_id: string;
          ends_at_home: boolean;
          id: string;
          notes: string | null;
          planned_end_at: string | null;
          planned_start_at: string | null;
          planner_run_id: string | null;
          route_date: string;
          status: string;
          tenant_id: string;
          total_actual_driving_minutes: number | null;
          total_actual_km: number | null;
          total_planned_deadhead_minutes: number | null;
          total_planned_driving_minutes: number | null;
          total_planned_km: number | null;
          updated_at: string;
          version: number;
        };
        Insert: {
          actual_end_at?: string | null;
          actual_start_at?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          driver_id: string;
          ends_at_home?: boolean;
          id?: string;
          notes?: string | null;
          planned_end_at?: string | null;
          planned_start_at?: string | null;
          planner_run_id?: string | null;
          route_date: string;
          status?: string;
          tenant_id: string;
          total_actual_driving_minutes?: number | null;
          total_actual_km?: number | null;
          total_planned_deadhead_minutes?: number | null;
          total_planned_driving_minutes?: number | null;
          total_planned_km?: number | null;
          updated_at?: string;
          version?: number;
        };
        Update: {
          actual_end_at?: string | null;
          actual_start_at?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          driver_id?: string;
          ends_at_home?: boolean;
          id?: string;
          notes?: string | null;
          planned_end_at?: string | null;
          planned_start_at?: string | null;
          planner_run_id?: string | null;
          route_date?: string;
          status?: string;
          tenant_id?: string;
          total_actual_driving_minutes?: number | null;
          total_actual_km?: number | null;
          total_planned_deadhead_minutes?: number | null;
          total_planned_driving_minutes?: number | null;
          total_planned_km?: number | null;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "routes_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "routes_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      stop_dwells: {
        Row: {
          arrived_at: string | null;
          created_at: string;
          departed_at: string | null;
          driver_id: string;
          dwell_date: string;
          dwell_minutes: number | null;
          id: string;
          job_id: string | null;
          job_stop_id: string | null;
          kind: string;
          tenant_id: string;
          warehouse_id: string | null;
        };
        Insert: {
          arrived_at?: string | null;
          created_at?: string;
          departed_at?: string | null;
          driver_id: string;
          dwell_date: string;
          dwell_minutes?: number | null;
          id?: string;
          job_id?: string | null;
          job_stop_id?: string | null;
          kind: string;
          tenant_id: string;
          warehouse_id?: string | null;
        };
        Update: {
          arrived_at?: string | null;
          created_at?: string;
          departed_at?: string | null;
          driver_id?: string;
          dwell_date?: string;
          dwell_minutes?: number | null;
          id?: string;
          job_id?: string | null;
          job_stop_id?: string | null;
          kind?: string;
          tenant_id?: string;
          warehouse_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "stop_dwells_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stop_dwells_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stop_dwells_job_stop_id_fkey";
            columns: ["job_stop_id"];
            isOneToOne: false;
            referencedRelation: "job_stops";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stop_dwells_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stop_dwells_warehouse_id_fkey";
            columns: ["warehouse_id"];
            isOneToOne: false;
            referencedRelation: "warehouses";
            referencedColumns: ["id"];
          },
        ];
      };
      super_admins: {
        Row: {
          created_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      warehouse_dwell_profiles: {
        Row: {
          avg_dwell_minutes: number | null;
          day_of_week: number;
          hour_of_day: number;
          id: string;
          kind: string;
          last_updated: string;
          p90_dwell_minutes: number | null;
          sample_count: number;
          tenant_id: string | null;
          warehouse_id: string;
        };
        Insert: {
          avg_dwell_minutes?: number | null;
          day_of_week: number;
          hour_of_day: number;
          id?: string;
          kind: string;
          last_updated?: string;
          p90_dwell_minutes?: number | null;
          sample_count?: number;
          tenant_id?: string | null;
          warehouse_id: string;
        };
        Update: {
          avg_dwell_minutes?: number | null;
          day_of_week?: number;
          hour_of_day?: number;
          id?: string;
          kind?: string;
          last_updated?: string;
          p90_dwell_minutes?: number | null;
          sample_count?: number;
          tenant_id?: string | null;
          warehouse_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "warehouse_dwell_profiles_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "warehouse_dwell_profiles_warehouse_id_fkey";
            columns: ["warehouse_id"];
            isOneToOne: false;
            referencedRelation: "warehouses";
            referencedColumns: ["id"];
          },
        ];
      };
      warehouse_hours: {
        Row: {
          close_time: string;
          created_at: string;
          day_of_week: number;
          id: string;
          is_closed: boolean;
          open_time: string;
          warehouse_id: string;
        };
        Insert: {
          close_time: string;
          created_at?: string;
          day_of_week: number;
          id?: string;
          is_closed?: boolean;
          open_time: string;
          warehouse_id: string;
        };
        Update: {
          close_time?: string;
          created_at?: string;
          day_of_week?: number;
          id?: string;
          is_closed?: boolean;
          open_time?: string;
          warehouse_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "warehouse_hours_warehouse_id_fkey";
            columns: ["warehouse_id"];
            isOneToOne: false;
            referencedRelation: "warehouses";
            referencedColumns: ["id"];
          },
        ];
      };
      warehouses: {
        Row: {
          address: string | null;
          code: string;
          created_at: string;
          deleted_at: string | null;
          geofence_radius_meters: number;
          id: string;
          latitude: number;
          longitude: number;
          name: string;
          tenant_id: string | null;
        };
        Insert: {
          address?: string | null;
          code: string;
          created_at?: string;
          deleted_at?: string | null;
          geofence_radius_meters?: number;
          id?: string;
          latitude: number;
          longitude: number;
          name: string;
          tenant_id?: string | null;
        };
        Update: {
          address?: string | null;
          code?: string;
          created_at?: string;
          deleted_at?: string | null;
          geofence_radius_meters?: number;
          id?: string;
          latitude?: number;
          longitude?: number;
          name?: string;
          tenant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "warehouses_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      current_driver_id: { Args: never; Returns: string };
      current_subscription_status: { Args: never; Returns: string };
      current_tenant_id: { Args: never; Returns: string };
      gen_driver_login_code: { Args: never; Returns: string };
      is_super_admin: { Args: never; Returns: boolean };
      log_gps: { Args: { points: Json }; Returns: Json };
      match_ai_knowledge_rrf: {
        Args: {
          match_count: number;
          p_tenant_id: string;
          query_embedding: string;
          query_text: string;
          rrf_k?: number;
        };
        Returns: {
          chunk_text: string;
          id: string;
          score: number;
        }[];
      };
      purge_activity_log: { Args: never; Returns: undefined };
      purge_old_jobs: { Args: { p_days?: number }; Returns: number };
      recompute_driver_day_hours: {
        Args: { p_day: string; p_driver_id: string };
        Returns: undefined;
      };
      refresh_lane_travel_times: { Args: never; Returns: undefined };
      run_data_retention: { Args: never; Returns: undefined };
      show_limit: { Args: never; Returns: number };
      show_trgm: { Args: { "": string }; Returns: string[] };
    };
    Enums: {
      driver_event_type:
        | "START_SHIFT"
        | "LOCATION_UPDATE"
        | "ACCEPT_JOB"
        | "REJECT_JOB"
        | "ARRIVED"
        | "DEPARTED"
        | "DELAY_REPORT"
        | "END_SHIFT"
        | "JOB_CARD_SENT"
        | "CANT_COMPLETE"
        | "END_SHIFT_BLOCKED"
        | "DRIVER_NOTE";
      driver_status: "AVAILABLE" | "ON_SHIFT" | "ON_ROUTE" | "DELAYED" | "OFF_SHIFT";
      job_status:
        | "PENDING"
        | "ASSIGNED"
        | "IN_PROGRESS"
        | "ARRIVED_PICKUP"
        | "EN_ROUTE_DELIVERY"
        | "COMPLETED"
        | "CANCELLED";
      registration_status: "AWAITING_NAME" | "AWAITING_PHONE" | "PENDING" | "APPROVED" | "REJECTED";
      stop_kind: "PICKUP" | "DROP";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      driver_event_type: [
        "START_SHIFT",
        "LOCATION_UPDATE",
        "ACCEPT_JOB",
        "REJECT_JOB",
        "ARRIVED",
        "DEPARTED",
        "DELAY_REPORT",
        "END_SHIFT",
        "JOB_CARD_SENT",
        "CANT_COMPLETE",
        "END_SHIFT_BLOCKED",
        "DRIVER_NOTE",
      ],
      driver_status: ["AVAILABLE", "ON_SHIFT", "ON_ROUTE", "DELAYED", "OFF_SHIFT"],
      job_status: [
        "PENDING",
        "ASSIGNED",
        "IN_PROGRESS",
        "ARRIVED_PICKUP",
        "EN_ROUTE_DELIVERY",
        "COMPLETED",
        "CANCELLED",
      ],
      registration_status: ["AWAITING_NAME", "AWAITING_PHONE", "PENDING", "APPROVED", "REJECTED"],
      stop_kind: ["PICKUP", "DROP"],
    },
  },
} as const;
