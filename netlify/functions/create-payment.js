// VizeKontrol — ödeme başlatma fonksiyonu (iyzico)
//
// iyzico başvurunuz onaylanıp API anahtarlarınızı aldıktan sonra:
//   Netlify > Environment variables kısmına ekleyin:
//     IYZICO_API_KEY
//     IYZICO_SECRET_KEY
//     IYZICO_BASE_URL  (sandbox: https://sandbox-api.iyzipay.com,
//                        canlı:   https://api.iyzipay.com)
//
// Bu anahtarlar tanımlı olmadığı sürece fonksiyon, kullanıcıya "ödeme
// sistemi henüz aktif değil" mesajı döner — site bu haliyle de güvenle
// yayında kalabilir, kimse yanlışlıkla ücretlendirilmez.
//
// NOT: Bu entegrasyon iyzico'nun resmi Node SDK'sı (iyzipay) ile, iyzico'nun
// dokümantasyonundaki standart "Checkout Form" akışına göre yazılmıştır.
// Gerçek sandbox anahtarlarınızla test edilmeden canlıya alınmamalıdır —
// iyzico onayınız gelince birlikte test edelim.

import Iyzipay from "iyzipay";
import { getSupabaseAdmin, getUserFromRequest } from "./_shared/supabaseAdmin.js";

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const CHECK_PRICE_TRY = "99.00";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
    body: JSON.stringify(body),
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Yalnızca POST istekleri kabul edilir." });
  }

  const iyzicoApiKey = process.env.IYZICO_API_KEY;
  const iyzicoSecretKey = process.env.IYZICO_SECRET_KEY;
  const iyzicoBaseUrl = process.env.IYZICO_BASE_URL;

  if (!iyzicoApiKey || !iyzicoSecretKey || !iyzicoBaseUrl) {
    return jsonResponse(503, {
      error: "Ödeme sistemi henüz aktif değil. Lütfen daha sonra tekrar deneyin.",
      code: "PAYMENTS_NOT_CONFIGURED",
    });
  }

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    return jsonResponse(500, { error: "Sunucu yapılandırması eksik (Supabase bağlı değil)." });
  }

  const { user, error: authError } = await getUserFromRequest(event, supabaseAdmin);
  if (!user) {
    return jsonResponse(401, { error: authError || "Giriş yapmanız gerekiyor." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return jsonResponse(400, { error: "Geçersiz istek gövdesi." });
  }

  const { callbackUrl } = payload || {};
  if (!callbackUrl) {
    return jsonResponse(400, { error: "callbackUrl gerekli." });
  }

  const iyzipay = new Iyzipay({
    apiKey: iyzicoApiKey,
    secretKey: iyzicoSecretKey,
    uri: iyzicoBaseUrl,
  });

  // Ödeme kaydını "pending" olarak oluştur — webhook geldiğinde bu kaydı
  // bulup durumunu güncelleyeceğiz ve kullanıcının kredisini artıracağız.
  const conversationId = `vk_${user.id}_${Date.now()}`;
  try {
    await supabaseAdmin.from("payments").insert({
      user_id: user.id,
      amount: Number(CHECK_PRICE_TRY),
      currency: "TRY",
      status: "pending",
      provider_ref: conversationId,
    });
  } catch (err) {
    console.error("Ödeme kaydı oluşturulamadı:", err.message);
    return jsonResponse(500, { error: "Ödeme başlatılamadı, lütfen tekrar deneyin." });
  }

  const request = {
    locale: "tr",
    conversationId,
    price: CHECK_PRICE_TRY,
    paidPrice: CHECK_PRICE_TRY,
    currency: "TRY",
    basketId: "vizekontrol-ek-kontrol",
    paymentGroup: "PRODUCT",
    callbackUrl,
    enabledInstallments: [1],
    buyer: {
      id: user.id,
      name: user.user_metadata?.full_name || "VizeKontrol",
      surname: "Kullanıcı",
      email: user.email,
      identityNumber: "11111111111",
      registrationAddress: "Türkiye",
      ip: event.headers["x-nf-client-connection-ip"] || "0.0.0.0",
      city: "Istanbul",
      country: "Turkey",
    },
    basketItems: [
      {
        id: "ek-kontrol",
        name: "VizeKontrol — Ek belge kontrolü",
        category1: "Dijital hizmet",
        itemType: "VIRTUAL",
        price: CHECK_PRICE_TRY,
      },
    ],
  };

  return new Promise((resolve) => {
    iyzipay.checkoutFormInitialize.create(request, (err, result) => {
      if (err || result.status !== "success") {
        console.error("iyzico başlatma hatası:", err || result?.errorMessage);
        resolve(jsonResponse(502, { error: "Ödeme başlatılamadı, lütfen tekrar deneyin." }));
        return;
      }
      resolve(jsonResponse(200, { checkoutFormContent: result.checkoutFormContent, token: result.token }));
    });
  });
};
