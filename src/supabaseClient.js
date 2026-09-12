// Supabase istemcisi — giriş sistemi ve geçmiş rapor kaydı için.
//
// Kendi Supabase projenizi oluşturduktan sonra (supabase.com, ücretsiz katman):
//   1) Project Settings > API sayfasından "Project URL" ve "anon public" anahtarını kopyalayın.
//   2) Aşağıdaki iki sabiti kendi değerlerinizle değiştirin.
//
// Bu anahtar "anon" (herkese açık) anahtardır — tarayıcıda görünmesi güvenlidir,
// çünkü Supabase tarafında Row Level Security (RLS) kuralları her kullanıcının
// yalnızca kendi verisine erişebilmesini sağlar (bkz. supabase-schema.sql).
import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://iskfhfedsayjpuhmpkyz.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_daSpfIeXcYPcXGTRVNagTA_HQTrEXJR";

export const isSupabaseConfigured =
  SUPABASE_URL !== "YOUR_SUPABASE_URL" && SUPABASE_ANON_KEY !== "YOUR_SUPABASE_ANON_KEY";

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
