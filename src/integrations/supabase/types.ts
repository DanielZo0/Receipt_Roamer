export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      associations: {
        Row: {
          address: string | null;
          created_at: string;
          id: string;
          keywords: string[];
          name: string;
          notes: string | null;
        };
        Insert: {
          address?: string | null;
          created_at?: string;
          id?: string;
          keywords?: string[];
          name: string;
          notes?: string | null;
        };
        Update: {
          address?: string | null;
          created_at?: string;
          id?: string;
          keywords?: string[];
          name?: string;
          notes?: string | null;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          created_at: string;
          id: string;
          keywords: string[];
          name: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          keywords?: string[];
          name: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          keywords?: string[];
          name?: string;
        };
        Relationships: [];
      };
      expenses: {
        Row: {
          amount: number | null;
          association_id: string | null;
          category: string | null;
          created_at: string;
          currency: string | null;
          expense_date: string | null;
          file_mime: string | null;
          file_path: string | null;
          id: string;
          ledger_group_id: string | null;
          raw_extraction: Json | null;
          reference_number: string | null;
          source_line_index: number | null;
          supplier: string | null;
        };
        Insert: {
          amount?: number | null;
          association_id?: string | null;
          category?: string | null;
          created_at?: string;
          currency?: string | null;
          expense_date?: string | null;
          file_mime?: string | null;
          file_path?: string | null;
          id?: string;
          ledger_group_id?: string | null;
          raw_extraction?: Json | null;
          reference_number?: string | null;
          source_line_index?: number | null;
          supplier?: string | null;
        };
        Update: {
          amount?: number | null;
          association_id?: string | null;
          category?: string | null;
          created_at?: string;
          currency?: string | null;
          expense_date?: string | null;
          file_mime?: string | null;
          file_path?: string | null;
          id?: string;
          ledger_group_id?: string | null;
          raw_extraction?: Json | null;
          reference_number?: string | null;
          source_line_index?: number | null;
          supplier?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "expenses_association_id_fkey";
            columns: ["association_id"];
            isOneToOne: false;
            referencedRelation: "associations";
            referencedColumns: ["id"];
          },
        ];
      };
      owners: {
        Row: {
          id: string;
          condominium_id: string | null;
          name: string;
          apartment: string | null;
          email: string | null;
          phone: string | null;
          id_number: string | null;
          yearly_contribution: number | null;
          contribution_paid: boolean;
          notes: string | null;
          vat_number: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          condominium_id?: string | null;
          name: string;
          apartment?: string | null;
          email?: string | null;
          phone?: string | null;
          id_number?: string | null;
          yearly_contribution?: number | null;
          contribution_paid?: boolean;
          notes?: string | null;
          vat_number?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          condominium_id?: string | null;
          name?: string;
          apartment?: string | null;
          email?: string | null;
          phone?: string | null;
          id_number?: string | null;
          yearly_contribution?: number | null;
          contribution_paid?: boolean;
          notes?: string | null;
          vat_number?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "owners_condominium_id_fkey";
            columns: ["condominium_id"];
            isOneToOne: false;
            referencedRelation: "associations";
            referencedColumns: ["id"];
          },
        ];
      };
      income_payments: {
        Row: {
          id: string;
          owner_id: string | null;
          condominium_id: string | null;
          payer_name: string | null;
          amount: number | null;
          currency: string | null;
          payment_date: string | null;
          reference_string: string | null;
          match_confidence: number | null;
          match_signals: string[] | null;
          file_path: string | null;
          file_mime: string | null;
          raw_extraction: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id?: string | null;
          condominium_id?: string | null;
          payer_name?: string | null;
          amount?: number | null;
          currency?: string | null;
          payment_date?: string | null;
          reference_string?: string | null;
          match_confidence?: number | null;
          match_signals?: string[] | null;
          file_path?: string | null;
          file_mime?: string | null;
          raw_extraction?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string | null;
          condominium_id?: string | null;
          payer_name?: string | null;
          amount?: number | null;
          currency?: string | null;
          payment_date?: string | null;
          reference_string?: string | null;
          match_confidence?: number | null;
          match_signals?: string[] | null;
          file_path?: string | null;
          file_mime?: string | null;
          raw_extraction?: Json | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "income_payments_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "owners";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "income_payments_condominium_id_fkey";
            columns: ["condominium_id"];
            isOneToOne: false;
            referencedRelation: "associations";
            referencedColumns: ["id"];
          },
        ];
      };
      upload_logs: {
        Row: {
          id: string;
          file_name: string;
          file_size: number | null;
          file_mime: string | null;
          status: "success" | "error";
          expense_id: string | null;
          error_message: string | null;
          input_tokens: number | null;
          output_tokens: number | null;
          estimated_cost_usd: number | null;
          pipeline: "expense" | "income";
          income_payment_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          file_name: string;
          file_size?: number | null;
          file_mime?: string | null;
          status: "success" | "error";
          expense_id?: string | null;
          error_message?: string | null;
          input_tokens?: number | null;
          output_tokens?: number | null;
          estimated_cost_usd?: number | null;
          pipeline?: "expense" | "income";
          income_payment_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          file_name?: string;
          file_size?: number | null;
          file_mime?: string | null;
          status?: "success" | "error";
          expense_id?: string | null;
          error_message?: string | null;
          input_tokens?: number | null;
          output_tokens?: number | null;
          estimated_cost_usd?: number | null;
          pipeline?: "expense" | "income";
          income_payment_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "upload_logs_expense_id_fkey";
            columns: ["expense_id"];
            isOneToOne: false;
            referencedRelation: "expenses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "upload_logs_income_payment_id_fkey";
            columns: ["income_payment_id"];
            isOneToOne: false;
            referencedRelation: "income_payments";
            referencedColumns: ["id"];
          },
        ];
      };
      extraction_audit_log: {
        Row: {
          id: string;
          expense_id: string;
          file_name: string | null;
          extracted_supplier: string | null;
          extracted_expense_date: string | null;
          extracted_amount: number | null;
          extracted_currency: string | null;
          extracted_category: string | null;
          extracted_association_id: string | null;
          extracted_reference_number: string | null;
          phase: string;
          validation_errors: Json | null;
          validation_warnings: Json | null;
          association_match_confidence: number | null;
          association_match_signals: string[] | null;
          llm_model: string | null;
          input_tokens: number | null;
          output_tokens: number | null;
          estimated_cost_usd: number | null;
          extraction_reasoning: string | null;
          pipeline_trace: Json | null;
          possible_duplicate_of: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          expense_id: string;
          file_name?: string | null;
          extracted_supplier?: string | null;
          extracted_expense_date?: string | null;
          extracted_amount?: number | null;
          extracted_currency?: string | null;
          extracted_category?: string | null;
          extracted_association_id?: string | null;
          extracted_reference_number?: string | null;
          phase: string;
          validation_errors?: Json | null;
          validation_warnings?: Json | null;
          association_match_confidence?: number | null;
          association_match_signals?: string[] | null;
          llm_model?: string | null;
          input_tokens?: number | null;
          output_tokens?: number | null;
          estimated_cost_usd?: number | null;
          extraction_reasoning?: string | null;
          pipeline_trace?: Json | null;
          possible_duplicate_of?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          expense_id?: string;
          file_name?: string | null;
          extracted_supplier?: string | null;
          extracted_expense_date?: string | null;
          extracted_amount?: number | null;
          extracted_currency?: string | null;
          extracted_category?: string | null;
          extracted_association_id?: string | null;
          extracted_reference_number?: string | null;
          phase?: string;
          validation_errors?: Json | null;
          validation_warnings?: Json | null;
          association_match_confidence?: number | null;
          association_match_signals?: string[] | null;
          llm_model?: string | null;
          input_tokens?: number | null;
          output_tokens?: number | null;
          estimated_cost_usd?: number | null;
          extraction_reasoning?: string | null;
          pipeline_trace?: Json | null;
          possible_duplicate_of?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "extraction_audit_log_expense_id_fkey";
            columns: ["expense_id"];
            isOneToOne: false;
            referencedRelation: "expenses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "extraction_audit_log_possible_duplicate_of_fkey";
            columns: ["possible_duplicate_of"];
            isOneToOne: false;
            referencedRelation: "expenses";
            referencedColumns: ["id"];
          },
        ];
      };
      expense_corrections: {
        Row: {
          id: string;
          expense_id: string;
          field: string;
          original_value: string | null;
          corrected_value: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          expense_id: string;
          field: string;
          original_value?: string | null;
          corrected_value?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          expense_id?: string;
          field?: string;
          original_value?: string | null;
          corrected_value?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "expense_corrections_expense_id_fkey";
            columns: ["expense_id"];
            isOneToOne: false;
            referencedRelation: "expenses";
            referencedColumns: ["id"];
          },
        ];
      };
      association_rules: {
        Row: {
          id: string;
          supplier_pattern: string;
          association_id: string;
          source_expense_id: string | null;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          supplier_pattern: string;
          association_id: string;
          source_expense_id?: string | null;
          active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          supplier_pattern?: string;
          association_id?: string;
          source_expense_id?: string | null;
          active?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "association_rules_association_id_fkey";
            columns: ["association_id"];
            isOneToOne: false;
            referencedRelation: "associations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "association_rules_source_expense_id_fkey";
            columns: ["source_expense_id"];
            isOneToOne: false;
            referencedRelation: "expenses";
            referencedColumns: ["id"];
          },
        ];
      };
      category_rules: {
        Row: {
          id: string;
          supplier_pattern: string;
          category: string;
          source_expense_id: string | null;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          supplier_pattern: string;
          category: string;
          source_expense_id?: string | null;
          active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          supplier_pattern?: string;
          category?: string;
          source_expense_id?: string | null;
          active?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "category_rules_source_expense_id_fkey";
            columns: ["source_expense_id"];
            isOneToOne: false;
            referencedRelation: "expenses";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
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
    Enums: {},
  },
} as const;
