// Netlify fonksiyonları için Supabase "admin" istemcisi.
//
// Bu dosya yalnızca sunucu tarafında (netlify/functions) çalışır — service
// role anahtarı Row Level Security'yi ATLAR, bu yüzden asla tarayıcıya
// gönderilecek kodda kullanılmamalıdır (src/ klasöründeki hiçbir dosyada
// bu anahtar geçmemeli).
//
// Gerekli ortam değişkenleri (Netlify > Environment variables):
//   SUPABASE_URL              — Supabase Project Settings > API
//   SUPABASE_SERVICE_ROLE_KEY — Supabase Project Settings > API > service_role (GİZLİ)

import { createClient } from "@supabase/supabase-js";

let cachedClient = null;

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!cachedClient) {
    cachedClient = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return cachedClient;
}

// İstek başlığındaki "Authorization: Bearer <token>" değerinden kullanıcıyı doğrular.
export async function getUserFromRequest(event, supabaseAdmin) {
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { user: null, error: "Oturum bulunamadı, lütfen giriş yapın." };

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    return { user: null, error: "Oturum geçersiz veya süresi dolmuş, lütfen tekrar giriş yapın." };
  }
  return { user: data.user, error: null };
}
