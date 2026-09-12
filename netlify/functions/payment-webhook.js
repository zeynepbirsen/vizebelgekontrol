// VizeKontrol — iyzico ödeme sonucu bildirimi (callback)
//
// iyzico Checkout Form akışında, ödeme tamamlandığında iyzico kullanıcıyı
// burada belirttiğiniz callbackUrl'e POST isteğiyle yönlendirir (token
// parametresiyle). Bu fonksiyon o isteği karşılar: ödemenin gerçekten
// başarılı olduğunu iyzico'dan tekrar sorgulayıp (retrieve) doğrular,
// başarılıysa kullanıcının kredi bakiyesini artırır.
//
// Gerekli ortam değişkenleri: analyze-documents.js ile aynı
// (IYZICO_API_KEY, IYZICO_SECRET_KEY, IYZICO_BASE_URL, SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY).
//
// ÖNEMLİ: Bu dosya iyzico sandbox ortamıyla henüz test edilmedi — gerçek
// anahtarlarınız gelince birlikte uçtan uca test etmemiz gerekiyor.

import Iyzipay from "iyzipay";
import { getSupabaseAdmin } from "./_shared/supabaseAdmin.js";

const SITE_URL = process.env.ALLOWED_ORIGIN || "/";
const CREDITS_PER_PAYMENT = 1;

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Yalnızca POST istekleri kabul edilir." };
  }

  const iyzicoApiKey = process.env.IYZICO_API_KEY;
  const iyzicoSecretKey = process.env.IYZICO_SECRET_KEY;
  const iyzicoBaseUrl = process.env.IYZICO_BASE_URL;
  if (!iyzicoApiKey || !iyzicoSecretKey || !iyzicoBaseUrl) {
    return { statusCode: 503, body: "Ödeme sistemi yapılandırılmamış." };
  }

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    return { statusCode: 500, body: "Sunucu yapılandırması eksik." };
  }

  const params = new URLSearchParams(event.body || "");
  const token = params.get("token");
  if (!token) {
    return { statusCode: 400, body: "token eksik." };
  }

  const iyzipay = new Iyzipay({ apiKey: iyzicoApiKey, secretKey: iyzicoSecretKey, uri: iyzicoBaseUrl });

  const result = await new Promise((resolve) => {
    iyzipay.checkoutForm.retrieve({ token, locale: "tr" }, (err, res) => {
      resolve(err ? null : res);
    });
  });

  const redirect = (status) => ({
    statusCode: 302,
    headers: { Location: `${SITE_URL}/?payment=${status}` },
    body: "",
  });

  if (!result || result.status !== "success" || result.paymentStatus !== "SUCCESS") {
    console.error("iyzico ödeme doğrulaması başarısız:", result?.errorMessage);
    return redirect("failed");
  }

  const conversationId = result.conversationId;

  try {
    const { data: payment } = await supabaseAdmin
      .from("payments")
      .select("id, user_id, status")
      .eq("provider_ref", conversationId)
      .single();

    if (!payment) {
      console.error("Eşleşen ödeme kaydı bulunamadı:", conversationId);
      return redirect("failed");
    }
    if (payment.status === "success") {
      // Zaten işlenmiş (ör. kullanıcı sayfayı yeniledi) — tekrar kredi eklemeden çık.
      return redirect("success");
    }

    await supabaseAdmin.from("payments").update({ status: "success" }).eq("id", payment.id);

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("credit_balance")
      .eq("id", payment.user_id)
      .single();

    await supabaseAdmin
      .from("profiles")
      .update({ credit_balance: (profile?.credit_balance || 0) + CREDITS_PER_PAYMENT })
      .eq("id", payment.user_id);
  } catch (err) {
    console.error("Ödeme sonrası kredi güncellenemedi:", err.message);
    return redirect("failed");
  }

  return redirect("success");
};
