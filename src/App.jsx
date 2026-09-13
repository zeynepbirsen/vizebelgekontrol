import React, { useState, useMemo, useRef } from "react";
import {
  Upload,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileText,
  ShieldCheck,
  ChevronRight,
  ChevronLeft,
  Info,
  Clock,
  Lock,
  Menu,
  X,
  Loader2,
  Stamp,
  BadgeCheck,
} from "lucide-react";
import { supabase } from "./supabaseClient.js";

/* ------------------------------------------------------------------
   TOKENS
------------------------------------------------------------------- */
const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;700&display=swap');`;

/* ------------------------------------------------------------------
   DEMO DATA
------------------------------------------------------------------- */
// Schengen bölgesi üyeleri (29 ülke) — ortak vize politikası nedeniyle
// aynı evrak modeli güvenle uygulanabilir.
const SCHENGEN_IDS = new Set([
  "AT", "BE", "BG", "HR", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IS", "IT", "LV", "LI", "LT", "LU", "MT", "NL", "NO", "PL", "PT", "RO",
  "SK", "SI", "ES", "SE", "CH",
]);

// Diğer Avrupa ülkeleri — yalnızca Türk vatandaşları için GERÇEKTEN vize
// gerektiren (ya da yakında gerektirecek) ülkeler. Arnavutluk, Bosna-Hersek,
// Belarus, Kosova, Moldova, Kuzey Makedonya, Sırbistan ve Ukrayna kısa süreli
// (30-90 gün) seyahatlerde vizesiz olduğu için listeye alınmadı — bu ülkeler
// için kullanıcının boşuna evrak listesi oluşturmasını istemiyoruz.
// Andorra, Monako, San Marino ve Vatikan'ın kendi vize sistemi yok; giriş
// komşu Schengen ülkesinin (Fransa/İtalya) sınırından yapılıyor, bu yüzden
// ayrı bir "ülke" olarak listelenmiyor.
const OTHER_EUROPE = [
  ["CY", "Kıbrıs", "Kıbrıs Cumhuriyeti'ne (Güney Kıbrıs) seyahat için Ulusal Vize gereklidir; başvuru Atina Büyükelçiliği üzerinden yapılır."],
  ["GB", "Birleşik Krallık", null],
  ["IE", "İrlanda", null],
  ["ME", "Karadağ", "ÖNEMLİ: Karadağ, 1 Kasım 2026 itibarıyla Türk vatandaşları için 30 günlük vize muafiyetini kaldırıyor. Bu tarihten sonraki seyahatler için vize gerekecek; öncesi için güncel durumu mutlaka teyit edin."],
  ["RU", "Rusya", "Umuma mahsus (bordo) pasaport sahipleri için vize gereklidir; yalnızca diplomatik/hususi/hizmet pasaport sahipleri 30 güne kadar muaftır."],
];

const SCHENGEN_LABELS = {
  AT: "Avusturya", BE: "Belçika", BG: "Bulgaristan", HR: "Hırvatistan",
  CZ: "Çekya", DK: "Danimarka", EE: "Estonya", FI: "Finlandiya",
  FR: "Fransa", DE: "Almanya", GR: "Yunanistan", HU: "Macaristan",
  IS: "İzlanda", IT: "İtalya", LV: "Letonya", LI: "Lihtenştayn",
  LT: "Litvanya", LU: "Lüksemburg", MT: "Malta", NL: "Hollanda",
  NO: "Norveç", PL: "Polonya", PT: "Portekiz", RO: "Romanya",
  SK: "Slovakya", SI: "Slovenya", ES: "İspanya", SE: "İsveç", CH: "İsviçre",
};

const COUNTRIES = [
  ...Object.entries(SCHENGEN_LABELS).map(([id, label]) => ({
    id,
    label,
    schengen: true,
    source: `${label} için resmî vize başvuru merkezi bilgilendirmesi`,
  })).sort((a, b) => a.label.localeCompare(b.label, "tr")),
  ...OTHER_EUROPE.map(([id, label, specialNote]) => ({
    id,
    label,
    schengen: false,
    specialNote,
    source: `${label} büyükelçiliği/başvuru merkezi resmî bilgilendirmesi`,
  })).sort((a, b) => a.label.localeCompare(b.label, "tr")),
];

const VISA_TYPES = ["Turistik", "Ticari"];

const EMPLOYMENT_OPTIONS = [
  "Ücretli çalışan",
  "Freelancer / şahıs şirketi sahibi",
  "Öğrenci",
  "İşsiz",
  "Emekli",
];

const EXPENSE_OPTIONS = ["Kendim", "Sponsor", "Davet eden şirket"];

const DOC_LIBRARY = {
  passport: "Pasaport",
  form: "Vize başvuru formu",
  photo: "Biyometrik fotoğraf",
  insurance: "Seyahat sağlık sigortası",
  flight: "Uçuş rezervasyonu",
  hotel: "Otel rezervasyonu",
  bank: "Banka hesap dökümü",
  letter: "Seyahat dilekçesi",
  invitation: "Davet mektubu",
  taxplate: "Vergi levhası",
  activity: "Faaliyet belgesi",
  sgk: "SGK hizmet dökümü",
  employer: "İşveren yazısı",
};

function buildChecklist(formData) {
  const ids = ["passport", "form", "photo", "insurance", "flight", "hotel", "bank", "letter"];

  if (formData.employment === "Ücretli çalışan") {
    ids.push("employer", "sgk");
  }
  if (formData.employment === "Freelancer / şahıs şirketi sahibi") {
    ids.push("taxplate", "activity", "sgk");
  }
  if (formData.hasInvitation === "Evet" || formData.visaType === "Ticari") {
    ids.push("invitation");
  }

  // de-duplicate while preserving order
  const seen = new Set();
  const finalIds = ids.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));

  return finalIds.map((id) => ({
    id,
    name: DOC_LIBRARY[id],
    status: "Yüklenmedi",
  }));
}

// Deterministic demo analysis outcome per document id, tuned to match
// the sample findings requested in the brief.
const ANALYSIS_RULES = {
  passport: {
    ok: "Pasaport geçerlilik tarihi teknik kontrolü karşılıyor.",
  },
  form: {
    ok: "Vize başvuru formu eksiksiz ve imzalı görünüyor.",
  },
  photo: {
    ok: "Biyometrik fotoğraf boyut ve arka plan gereksinimlerini karşılıyor.",
  },
  insurance: {
    ok: "Seyahat sağlık sigortası teminat tutarı ve tarih aralığı uygun görünüyor.",
    missing: "Seyahat sağlık sigortası yüklenmemiş.",
  },
  flight: {
    ok: "Uçuş rezervasyonu tarihleri beyan edilen seyahat tarihleriyle uyumlu.",
  },
  hotel: {
    review: "Davet mektubundaki seyahat tarihleri ile otel rezervasyonu birbiriyle uyuşmuyor.",
  },
  bank: {
    review: "Banka hesap dökümü son 90 günün tamamını kapsamıyor olabilir.",
  },
  letter: {
    review: "Freelancer gelirini açıklayan bir seyahat dilekçesi eklemeniz önerilir.",
    ok: "Seyahat dilekçesi seyahat amacını ve süresini açıkça belirtiyor.",
  },
  invitation: {
    review: "Davet mektubundaki tarihler diğer belgelerle birebir örtüşmüyor, kontrol edilmeli.",
  },
  taxplate: {
    ok: "Vergi levhası güncel ve okunaklı.",
  },
  activity: {
    ok: "Faaliyet belgesi son 6 ay içinde alınmış.",
  },
  sgk: {
    ok: "SGK hizmet dökümü çalışma geçmişini destekliyor.",
  },
  employer: {
    ok: "İşveren yazısı izin tarihlerini ve unvanı içeriyor.",
  },
};

const SUGGESTIONS_POOL = {
  freelance: "Freelancer gelirini açıklayan bir seyahat dilekçesi eklemeniz önerilir.",
  insuranceRange: "Seyahat sağlık sigortasının tüm seyahat tarihlerini kapsadığından emin olun.",
  bankHistory: "Banka hesap dökümünde son 90 güne ait tüm sayfaların yer aldığından emin olun.",
  consistency: "Tüm belgelerdeki isim, tarih ve adres bilgilerinin birebir aynı olduğunu kontrol edin.",
};

/* ------------------------------------------------------------------
   GERÇEK BACKEND BAĞLANTISI
   Cloudflare Turnstile'dan alacağınız "site key"i buraya yapıştırın.
   Boş/placeholder kalırsa bot doğrulaması devre dışı kalır (yalnızca
   geliştirme/önizleme içindir — gerçek yayında mutlaka doldurun).
------------------------------------------------------------------- */
const TURNSTILE_SITE_KEY = "YOUR_TURNSTILE_SITE_KEY";
const ANALYZE_ENDPOINT = "/.netlify/functions/analyze-documents";

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("Dosya okunamadı: " + file.name));
    reader.readAsDataURL(file);
  });
}

function guessMimeFromName(name) {
  const ext = (name || "").split(".").pop().toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "application/octet-stream";
}

// Backend'in döndürdüğü { scores, documents, suggestions } yapısını
// StepResult bileşeninin beklediği { scores, groups, suggestions } yapısına çevirir.
function normalizeApiReport(apiData) {
  const results = (Array.isArray(apiData.documents) ? apiData.documents : []).map((d, i) => ({
    id: d.id || d.name || `doc-${i}`,
    ...d,
  }));
  return {
    results,
    scores: {
      completeness: apiData.scores?.completeness ?? 0,
      technical: apiData.scores?.technical ?? 0,
      consistency: apiData.scores?.consistency ?? 0,
    },
    groups: {
      critical: results.filter((d) => d.status === "Eksik"),
      review: results.filter((d) => d.status === "İncelenmeli"),
      ok: results.filter((d) => d.status === "Uygun"),
    },
    suggestions: Array.isArray(apiData.suggestions) ? apiData.suggestions : [],
  };
}

/* ------------------------------------------------------------------
   SMALL UI PRIMITIVES
------------------------------------------------------------------- */
function StatusChip({ status }) {
  const map = {
    Yüklenmedi: { cls: "chip chip--muted", icon: <FileText size={14} /> },
    Yüklendi: { cls: "chip chip--info", icon: <CheckCircle2 size={14} /> },
    "Kontrol ediliyor": { cls: "chip chip--pending", icon: <Loader2 size={14} className="spin" /> },
    Uygun: { cls: "chip chip--ok", icon: <BadgeCheck size={14} /> },
    İncelenmeli: { cls: "chip chip--warn", icon: <AlertTriangle size={14} /> },
    Eksik: { cls: "chip chip--bad", icon: <XCircle size={14} /> },
  };
  const m = map[status] || map["Yüklenmedi"];
  return (
    <span className={m.cls}>
      {m.icon}
      {status}
    </span>
  );
}

function ScoreDial({ label, value, tone }) {
  const circumference = 2 * Math.PI * 42;
  const offset = circumference - (value / 100) * circumference;
  const toneColor =
    tone === "good" ? "var(--green)" : tone === "warn" ? "var(--amber-icon)" : "var(--navy)";
  return (
    <div className="score-dial">
      <svg viewBox="0 0 100 100" className="score-dial__svg">
        <circle cx="50" cy="50" r="42" className="score-dial__track" />
        <circle
          cx="50"
          cy="50"
          r="42"
          className="score-dial__fill"
          style={{ stroke: toneColor, strokeDasharray: circumference, strokeDashoffset: offset }}
        />
      </svg>
      <div className="score-dial__value">{value}</div>
      <div className="score-dial__label">{label}</div>
    </div>
  );
}

/* ------------------------------------------------------------------
   STEPPER (signature element — passport-stamp motif on completion)
------------------------------------------------------------------- */
function Stepper({ step }) {
  const steps = ["Başvuru Bilgileri", "Belgeler", "Kontrol Sonucu"];
  return (
    <div className="stepper" role="list" aria-label="Başvuru adımları">
      {steps.map((label, i) => {
        const idx = i + 1;
        const state = idx < step ? "done" : idx === step ? "active" : "todo";
        return (
          <React.Fragment key={label}>
            <div className="stepper__item" role="listitem">
              <div className={`stepper__mark stepper__mark--${state}`}>
                {state === "done" ? <Stamp size={16} /> : idx}
              </div>
              <span className={`stepper__label stepper__label--${state}`}>{label}</span>
            </div>
            {idx < steps.length && <div className={`stepper__line stepper__line--${idx < step ? "done" : "todo"}`} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------
   NAVBAR
------------------------------------------------------------------- */
function NavBar({ onHome, session, onLoginClick, onLogout, onHistoryClick }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="nav">
      <div className="nav__inner">
        <button className="nav__brand" onClick={onHome} aria-label="Ana sayfaya dön">
          <span className="nav__logo" aria-hidden="true">
            <ShieldCheck size={18} />
          </span>
          <span className="nav__brand-text">
            Vize<span className="nav__brand-accent">Kontrol</span>
          </span>
        </button>
        <nav className="nav__links nav__links--desktop" aria-label="Ana gezinme">
          <a href="#nasil-calisir">Nasıl çalışır?</a>
          <a href="#guvenlik">Güvenlik</a>
          <a href="#sss">Sık Sorulanlar</a>
          {session ? (
            <>
              <button className="nav__link-btn" type="button" onClick={onHistoryClick}>Geçmişim</button>
              <span className="nav__user-email" title={session.user.email}>{session.user.email}</span>
              <button className="nav__login" type="button" onClick={onLogout}>Çıkış yap</button>
            </>
          ) : (
            <button className="nav__login" type="button" onClick={onLoginClick}>Giriş Yap</button>
          )}
        </nav>
        <button
          className="nav__toggle"
          aria-label={open ? "Menüyü kapat" : "Menüyü aç"}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      {open && (
        <nav className="nav__links nav__links--mobile" aria-label="Mobil gezinme">
          <a href="#nasil-calisir" onClick={() => setOpen(false)}>Nasıl çalışır?</a>
          <a href="#guvenlik" onClick={() => setOpen(false)}>Güvenlik</a>
          <a href="#sss" onClick={() => setOpen(false)}>Sık Sorulanlar</a>
          {session ? (
            <>
              <button className="nav__link-btn" type="button" onClick={() => { setOpen(false); onHistoryClick(); }}>Geçmişim</button>
              <button className="nav__login" type="button" onClick={() => { setOpen(false); onLogout(); }}>Çıkış yap ({session.user.email})</button>
            </>
          ) : (
            <button className="nav__login" type="button" onClick={() => { setOpen(false); onLoginClick(); }}>Giriş Yap</button>
          )}
        </nav>
      )}
    </header>
  );
}

/* ------------------------------------------------------------------
   GİRİŞ / KAYIT MODALİ
------------------------------------------------------------------- */
function AuthModal({ onClose, onSuccess }) {
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setNotice("");
    if (!supabase) {
      setError("Giriş sistemi henüz yapılandırılmadı. Lütfen daha sonra tekrar deneyin.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) throw signUpError;
        setNotice("Kayıt oluşturuldu. E-postanıza gelen bağlantıyla hesabınızı onaylayıp giriş yapabilirsiniz.");
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        onSuccess?.();
      }
    } catch (err) {
      setError(err.message || "Bir hata oluştu, lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Giriş yap veya kayıt ol">
      <div className="modal-card">
        <button className="modal-close" onClick={onClose} aria-label="Kapat"><X size={18} /></button>
        <h2 className="card__title">{mode === "login" ? "Giriş yap" : "Hesap oluştur"}</h2>
        <p className="card__sub">
          {mode === "login"
            ? "Geçmiş kontrollerinizi görebilmek için giriş yapın."
            : "İlk kontrolünüz ücretsiz — hesap oluşturup hemen başlayabilirsiniz."}
        </p>
        <form onSubmit={submit} className="auth-form">
          <div className="field">
            <label htmlFor="auth-email">E-posta</label>
            <input
              id="auth-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div className="field">
            <label htmlFor="auth-password">Şifre</label>
            <input
              id="auth-password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </div>
          {error && <p className="field__err">{error}</p>}
          {notice && <p className="auth-notice">{notice}</p>}
          <button type="submit" className="btn btn--primary" disabled={busy} style={{ width: "100%", justifyContent: "center" }}>
            {busy ? "Lütfen bekleyin…" : mode === "login" ? "Giriş yap" : "Kayıt ol"}
          </button>
        </form>
        <button
          type="button"
          className="auth-switch"
          onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); setNotice(""); }}
        >
          {mode === "login" ? "Hesabınız yok mu? Kayıt olun" : "Zaten hesabınız var mı? Giriş yapın"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   ÖDEME GEREKLİ EKRANI
------------------------------------------------------------------- */
function PaymentRequired({ onBack }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [formHtml, setFormHtml] = useState(null);
  const containerRef = useRef(null);

  React.useEffect(() => {
    if (!formHtml || !containerRef.current) return;
    containerRef.current.innerHTML = formHtml;
    // Enjekte edilen HTML içindeki <script> etiketleri innerHTML ile
    // otomatik çalışmaz — bu yüzden onları bulup yeniden oluşturuyoruz.
    const scripts = containerRef.current.querySelectorAll("script");
    scripts.forEach((oldScript) => {
      const newScript = document.createElement("script");
      Array.from(oldScript.attributes).forEach((attr) => newScript.setAttribute(attr.name, attr.value));
      newScript.textContent = oldScript.textContent;
      oldScript.replaceWith(newScript);
    });
  }, [formHtml]);

  const startPayment = async () => {
    setBusy(true);
    setError("");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const callbackUrl = `${window.location.origin}/.netlify/functions/payment-webhook`;
      const res = await fetch("/.netlify/functions/create-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ callbackUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Ödeme başlatılamadı.");
        return;
      }
      setFormHtml(data.checkoutFormContent);
    } catch (err) {
      setError("Ödeme başlatılırken bir hata oluştu, lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2 className="card__title">Ücretsiz hakkınızı kullandınız</h2>
      <p className="card__sub">
        İlk kontrolünüz ücretsizdi. Devam etmek için 99 TL karşılığında ek bir kontrol satın
        alabilirsiniz.
      </p>
      {!formHtml && (
        <>
          <button className="btn btn--primary" onClick={startPayment} disabled={busy}>
            {busy ? "Yönlendiriliyor…" : "99 TL öde ve devam et"}
          </button>
          {error && <p className="field__err" style={{ marginTop: 10 }}>{error}</p>}
        </>
      )}
      <div ref={containerRef} />
      <div className="card__actions">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          <ChevronLeft size={16} /> Geri
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   GEÇMİŞİM
------------------------------------------------------------------- */
function HistoryView({ onBack, onOpenReport }) {
  const [reports, setReports] = useState(null);
  const [error, setError] = useState("");

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) {
        setError("Giriş sistemi henüz yapılandırılmadı.");
        return;
      }
      const { data, error: fetchError } = await supabase
        .from("reports")
        .select("id, form_data, report_data, demo_mode, created_at")
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (fetchError) {
        setError("Geçmiş raporlar yüklenemedi.");
        return;
      }
      setReports(data || []);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="card">
      <h2 className="card__title">Geçmişim</h2>
      <p className="card__sub">Daha önce oluşturduğunuz kontrol raporları.</p>

      {error && <p className="field__err">{error}</p>}
      {!error && reports === null && <p className="card__sub">Yükleniyor…</p>}
      {!error && reports && reports.length === 0 && (
        <p className="card__sub">Henüz bir kontrol yapmadınız.</p>
      )}

      <div className="history-list">
        {reports?.map((r) => {
          const country = COUNTRIES.find((c) => c.id === r.form_data?.country)?.label || r.form_data?.country;
          const date = new Date(r.created_at).toLocaleString("tr-TR");
          return (
            <button key={r.id} className="history-item" onClick={() => onOpenReport(r)}>
              <div>
                <p className="history-item__title">{country} · {r.form_data?.visaType}</p>
                <p className="history-item__date">{date}{r.demo_mode ? " · Demo modu" : ""}</p>
              </div>
              <ChevronRight size={16} />
            </button>
          );
        })}
      </div>

      <div className="card__actions card__actions--end">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          <ChevronLeft size={16} /> Geri
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   LANDING / HERO
------------------------------------------------------------------- */
function Landing({ onStart }) {
  return (
    <>
      <section className="hero">
        <div className="hero__inner">
          <p className="hero__eyebrow">
            <Stamp size={14} /> Başvuru öncesi belge ön kontrolü
          </p>
          <h1 className="hero__headline">Vize dosyanızı <span className="hero__headline-grad">teslim etmeden önce</span> kontrol edin.</h1>
          <p className="hero__sub">
            Eksik belgeleri, tarih uyuşmazlıklarını ve teknik sorunları yapay zekâ destekli ön
            kontrol ile tespit edin.
          </p>
          <button className="btn btn--primary btn--lg" onClick={onStart}>
            Ücretsiz evrak listemi oluştur <ChevronRight size={18} />
          </button>

          <ul className="hero__trust">
            <li className="hero__trust-item hero__trust-item--mint">
              <CheckCircle2 size={16} /> Kişiselleştirilmiş evrak listesi
            </li>
            <li className="hero__trust-item hero__trust-item--sky">
              <CheckCircle2 size={16} /> Belgeler arası tarih ve bilgi kontrolü
            </li>
            <li className="hero__trust-item hero__trust-item--lavender">
              <CheckCircle2 size={16} /> Resmî kaynaklara dayalı gereklilikler
            </li>
          </ul>
        </div>
        <div className="hero__panel" aria-hidden="true">
          <div className="hero__panel-card">
            <div className="hero__panel-row">
              <span>Pasaport</span>
              <StatusChip status="Uygun" />
            </div>
            <div className="hero__panel-row">
              <span>Otel rezervasyonu</span>
              <StatusChip status="İncelenmeli" />
            </div>
            <div className="hero__panel-row">
              <span>Seyahat sağlık sigortası</span>
              <StatusChip status="Eksik" />
            </div>
            <div className="hero__panel-stamp">
              <Stamp size={26} />
              <span>Ön kontrol tamamlandı</span>
            </div>
          </div>
        </div>
      </section>

      <section id="nasil-calisir" className="info-section">
        <h2>Nasıl çalışır?</h2>
        <div className="info-grid">
          <div className="info-card">
            <span className="info-card__num">1</span>
            <h3>Başvuru bilgilerinizi girin</h3>
            <p>Hedef ülke, vize türü ve durumunuza göre size özel bir evrak listesi oluşturulur.</p>
          </div>
          <div className="info-card">
            <span className="info-card__num">2</span>
            <h3>Belgelerinizi yükleyin</h3>
            <p>PDF, JPG veya PNG formatında belgelerinizi sürükleyip bırakın.</p>
          </div>
          <div className="info-card">
            <span className="info-card__num">3</span>
            <h3>Yapay zekâ kontrolünü alın</h3>
            <p>Belgeleriniz yapay zekâ ile analiz edilir; eksikler, düzeltilmesi gerekenler ve öneriler tek bir raporda sunulur.</p>
          </div>
        </div>
      </section>

      <section id="guvenlik" className="info-section info-section--muted">
        <h2>Güvenlik</h2>
        <div className="security-grid">
          <div className="security-item">
            <Lock size={18} />
            <div>
              <h3>Kalıcı saklama yok</h3>
              <p>Belgeleriniz analiz sırasında yalnızca geçici olarak işlenir; işlem bitince sistemden silinir.</p>
            </div>
          </div>
          <div className="security-item">
            <ShieldCheck size={18} />
            <div>
              <h3>Bot ve kötüye kullanım koruması</h3>
              <p>İnsan doğrulaması (Cloudflare Turnstile), istek başına hız sınırlama ve günlük kullanım kotası ile korunuyoruz.</p>
            </div>
          </div>
          <div className="security-item">
            <Info size={18} />
            <div>
              <h3>Şeffaf üçüncü taraf kullanımı</h3>
              <p>Analiz, ABD merkezli yapay zekâ sağlayıcısı Anthropic (Claude) üzerinden yapılır. Bunu gizlemiyoruz — Belgeler adımındaki Aydınlatma Metni'nde açıkça belirtiyoruz.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="sss" className="info-section">
        <h2>Sık Sorulanlar</h2>
        <div className="faq">
          <details>
            <summary>Bu servis vizemin onaylanacağını garanti ediyor mu?</summary>
            <p>
              Hayır. Bu yalnızca başvuru öncesi teknik bir belge kontrolüdür. Nihai karar ilgili
              konsolosluk veya temsilcilik tarafından verilir.
            </p>
          </details>
          <details>
            <summary>Hangi ülkeler için evrak listesi oluşturabilirim?</summary>
            <p>
              Schengen bölgesindeki 29 ülkenin tamamı, ayrıca Birleşik Krallık, İrlanda, Kıbrıs,
              Rusya ve Karadağ için kişiselleştirilmiş listeler sunuyoruz. Türk vatandaşlarının
              kısa süreli seyahatlerde zaten vizesiz girebildiği Balkan ülkeleri (Sırbistan,
              Bosna-Hersek, Kuzey Makedonya, Arnavutluk, Kosova), Belarus, Moldova ve Ukrayna
              listede yer almıyor — çünkü bu ülkeler için vize başvurusuna gerek yok.
            </p>
          </details>
          <details>
            <summary>Belgelerim ne kadar süre saklanıyor ve nereye gidiyor?</summary>
            <p>
              Belgeleriniz analiz için Anthropic'in (Claude) yapay zekâ servisine gönderilir,
              yalnızca analiz süresince işlenir ve tamamlandıktan hemen sonra silinir. Ayrıntılar
              için Belgeler adımındaki Aydınlatma Metni'ne bakabilirsiniz.
            </p>
          </details>
          <details>
            <summary>Karadağ neden farklı görünüyor?</summary>
            <p>
              Karadağ, Türk vatandaşları için 1 Kasım 2026'ya kadar vizesiz; bu tarihten sonra
              vize zorunlu hâle geliyor. Bu geçiş dönemi nedeniyle listede özel bir uyarıyla yer
              alıyor.
            </p>
          </details>
        </div>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------
   STEP 1 — APPLICATION PROFILE
------------------------------------------------------------------- */
function StepProfile({ formData, setFormData, onNext }) {
  const [errors, setErrors] = useState({});
  const [showSummary, setShowSummary] = useState(false);
  const [debugLog, setDebugLog] = useState("Henüz butona basılmadı.");
  const formTopRef = useRef(null);

  const update = (field, value) => setFormData((f) => ({ ...f, [field]: value }));

  const FIELD_LABELS = {
    country: "Hedef ülke",
    visaType: "Vize türü",
    employment: "Çalışma durumu",
    startDate: "Gidiş tarihi",
    endDate: "Dönüş tarihi",
    expensePayer: "Masraf karşılayıcı",
    hasInvitation: "Davet mektubu bilgisi",
  };

  const validate = () => {
    const e = {};
    if (!formData.country) e.country = "Hedef ülke seçin.";
    if (!formData.visaType) e.visaType = "Vize türü seçin.";
    if (!formData.employment) e.employment = "Çalışma durumunuzu seçin.";
    if (!formData.startDate) e.startDate = "Gidiş tarihi girin.";
    if (!formData.endDate) e.endDate = "Dönüş tarihi girin.";
    if (formData.startDate && formData.endDate && formData.endDate < formData.startDate) {
      e.endDate = "Dönüş tarihi gidiş tarihinden önce olamaz.";
    }
    if (!formData.expensePayer) e.expensePayer = "Masrafları kimin karşılayacağını seçin.";
    if (!formData.hasInvitation) e.hasInvitation = "Bu bilgiyi seçin.";
    setErrors(e);
    return e;
  };

  const handleSubmit = (ev) => {
    ev.preventDefault();
    setDebugLog(
      "Buton tıklandı: " + new Date().toLocaleTimeString("tr-TR") + "\n" +
      "Girilen değerler: " + JSON.stringify(formData, null, 2)
    );
    let errs;
    try {
      errs = validate();
    } catch (err) {
      setDebugLog((prev) => prev + "\n\nDOĞRULAMA SIRASINDA HATA:\n" + String(err?.stack || err));
      return;
    }
    const ok = Object.keys(errs).length === 0;
    setShowSummary(!ok);
    if (ok) {
      try {
        onNext();
        setDebugLog((prev) => prev + "\n\nSonuç: BAŞARILI — bir sonraki adıma geçiliyor.");
      } catch (err) {
        setDebugLog((prev) => prev + "\n\nBİR SONRAKİ ADIMA GEÇERKEN HATA:\n" + String(err?.stack || err));
      }
    } else {
      setDebugLog((prev) => prev + "\n\nSonuç: BAŞARISIZ — eksik alanlar: " + Object.keys(errs).join(", "));
      try {
        formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (err) {
        console.warn("scrollIntoView desteklenmiyor:", err);
      }
    }
  };

  return (
    <div className="card form-card" ref={formTopRef}>
      <h2 className="card__title">Başvuru Bilgileri</h2>
      <p className="card__sub">Size özel evrak listesi oluşturmak için birkaç bilgiye ihtiyacımız var.</p>

      {showSummary && Object.keys(errors).length > 0 && (
        <div className="form-summary-error" role="alert">
          <AlertTriangle size={16} />
          <div>
            <p className="form-summary-error__title">Devam etmeden önce şu alanları tamamlayın:</p>
            <ul>
              {Object.keys(errors).map((key) => (
                <li key={key}>{FIELD_LABELS[key] || key}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="form-grid">
        <div className="field">
          <label htmlFor="country">Hedef ülke</label>
          <select
            id="country"
            required
            value={formData.country}
            onChange={(e) => update("country", e.target.value)}
            aria-invalid={!!errors.country}
            aria-describedby={errors.country ? "country-err" : undefined}
          >
            <option value="">Seçiniz</option>
            <optgroup label="Schengen bölgesi">
              {COUNTRIES.filter((c) => c.schengen).map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </optgroup>
            <optgroup label="Diğer Avrupa ülkeleri">
              {COUNTRIES.filter((c) => !c.schengen).map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </optgroup>
          </select>
          {errors.country && <span className="field__err" id="country-err">{errors.country}</span>}
        </div>

        <div className="field">
          <label htmlFor="visaType">Vize türü</label>
          <select
            id="visaType"
            required
            value={formData.visaType}
            onChange={(e) => update("visaType", e.target.value)}
            aria-invalid={!!errors.visaType}
          >
            <option value="">Seçiniz</option>
            {VISA_TYPES.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
          {errors.visaType && <span className="field__err">{errors.visaType}</span>}
        </div>

        <div className="field field--full">
          <label htmlFor="employment">Çalışma durumu</label>
          <select
            id="employment"
            required
            value={formData.employment}
            onChange={(e) => update("employment", e.target.value)}
            aria-invalid={!!errors.employment}
          >
            <option value="">Seçiniz</option>
            {EMPLOYMENT_OPTIONS.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
          {errors.employment && <span className="field__err">{errors.employment}</span>}
        </div>

        <div className="field">
          <label htmlFor="startDate">Gidiş tarihi</label>
          <input
            id="startDate"
            type="date"
            required
            value={formData.startDate}
            onChange={(e) => update("startDate", e.target.value)}
            aria-invalid={!!errors.startDate}
          />
          {errors.startDate && <span className="field__err">{errors.startDate}</span>}
        </div>

        <div className="field">
          <label htmlFor="endDate">Dönüş tarihi</label>
          <input
            id="endDate"
            type="date"
            required
            value={formData.endDate}
            onChange={(e) => update("endDate", e.target.value)}
            aria-invalid={!!errors.endDate}
          />
          {errors.endDate && <span className="field__err">{errors.endDate}</span>}
        </div>

        <div className="field field--full">
          <label>Seyahat masraflarını kim karşılayacak?</label>
          <div className="radio-row" role="radiogroup" aria-label="Masraf karşılayıcı">
            {EXPENSE_OPTIONS.map((opt) => (
              <label key={opt} className="radio-pill">
                <input
                  type="radio"
                  name="expensePayer"
                  required
                  value={opt}
                  checked={formData.expensePayer === opt}
                  onChange={(e) => update("expensePayer", e.target.value)}
                />
                {opt}
              </label>
            ))}
          </div>
          {errors.expensePayer && <span className="field__err">{errors.expensePayer}</span>}
        </div>

        <div className="field field--full">
          <label>Davet mektubunuz var mı?</label>
          <div className="radio-row" role="radiogroup" aria-label="Davet mektubu durumu">
            {["Evet", "Hayır"].map((opt) => (
              <label key={opt} className="radio-pill">
                <input
                  type="radio"
                  name="hasInvitation"
                  required
                  value={opt}
                  checked={formData.hasInvitation === opt}
                  onChange={(e) => update("hasInvitation", e.target.value)}
                />
                {opt}
              </label>
            ))}
          </div>
          {errors.hasInvitation && <span className="field__err">{errors.hasInvitation}</span>}
        </div>
      </div>

      <div className="card__actions card__actions--end">
        <button type="button" className="btn btn--primary" onClick={handleSubmit}>
          Evrak listemi oluştur <ChevronRight size={16} />
        </button>
      </div>

      <div className="debug-panel">
        <p className="debug-panel__title">Teşhis paneli (geçici)</p>
        <pre>{debugLog}</pre>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   STEP 2 — DOCUMENT CHECKLIST & UPLOAD
------------------------------------------------------------------- */
function DocRow({ doc, onUpload, sourceLabel }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const acceptFile = (file) => {
    if (!file) return;
    const okType = /\.(pdf|jpg|jpeg|png)$/i.test(file.name);
    if (!okType) return;
    onUpload(doc.id, file.name, file);
  };

  return (
    <div className={`doc-row ${dragOver ? "doc-row--drag" : ""}`}>
      <div className="doc-row__main">
        <FileText size={18} className="doc-row__icon" />
        <div>
          <p className="doc-row__name">{doc.name}</p>
          <p className="doc-row__source">{sourceLabel}</p>
        </div>
      </div>

      <div className="doc-row__right">
        <StatusChip status={doc.status} />
        <div
          className="dropzone"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            acceptFile(e.dataTransfer.files?.[0]);
          }}
        >
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => inputRef.current?.click()}
          >
            <Upload size={14} />
            {doc.status === "Yüklenmedi" ? "Dosya seç" : "Değiştir"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            className="sr-only"
            onChange={(e) => acceptFile(e.target.files?.[0])}
            aria-label={`${doc.name} dosyasını yükle`}
          />
        </div>
      </div>
    </div>
  );
}

function StepDocuments({
  docs, setDocs, formData, consent, setConsent, onBack, onCheck,
  turnstileToken, setTurnstileToken, checkError,
}) {
  const country = COUNTRIES.find((c) => c.id === formData.country);
  const sourceLabel = country
    ? `Kaynak: ${country.source} — Son kontrol: 29 Ağustos 2026`
    : "";

  const turnstileRef = useRef(null);
  const turnstileConfigured = TURNSTILE_SITE_KEY && TURNSTILE_SITE_KEY !== "YOUR_TURNSTILE_SITE_KEY";

  React.useEffect(() => {
    if (!turnstileConfigured) return;
    if (!window.turnstile || !turnstileRef.current) return;
    const widgetId = window.turnstile.render(turnstileRef.current, {
      sitekey: TURNSTILE_SITE_KEY,
      callback: (token) => setTurnstileToken(token),
      "expired-callback": () => setTurnstileToken(""),
    });
    return () => {
      try { window.turnstile.remove(widgetId); } catch (err) { /* widget already gone */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnstileConfigured]);

  const handleUpload = (id, fileName, file) => {
    setDocs((prev) =>
      prev.map((d) => (d.id === id ? { ...d, status: "Yüklendi", fileName, file } : d))
    );
  };

  const uploadedCount = docs.filter((d) => d.status !== "Yüklenmedi").length;
  const humanVerified = !turnstileConfigured || !!turnstileToken;
  const canCheck = consent && uploadedCount > 0 && humanVerified;

  return (
    <div className="card">
      <h2 className="card__title">Belgeler</h2>
      <p className="card__sub">
        Seçimlerinize göre oluşturulan kişiselleştirilmiş evrak listeniz aşağıda. Belgelerinizi
        PDF, JPG veya PNG formatında yükleyebilirsiniz.
      </p>

      {country && !country.schengen && (
        <div className={`schengen-note ${country.specialNote ? "schengen-note--warn" : ""}`}>
          <Info size={16} />
          <p>
            {country.specialNote || (
              <>
                {country.label} Schengen bölgesi dışındadır. Aşağıdaki liste genel bir taban
                olarak hazırlanmıştır; kesin gereklilikler için {country.label} büyükelçiliği
                veya başvuru merkezinin güncel bilgilerini mutlaka kontrol edin.
              </>
            )}
          </p>
        </div>
      )}

      <div className="doc-list">
        {docs.map((doc) => (
          <DocRow key={doc.id} doc={doc} onUpload={handleUpload} sourceLabel={sourceLabel} />
        ))}
      </div>

      <div className="privacy-note">
        <Lock size={16} />
        <p>Belgeleriniz yalnızca kontrol amacıyla işlenir ve analiz tamamlandıktan sonra silinir.</p>
      </div>

      <details className="kvkk-details">
        <summary>Aydınlatma Metni (KVKK) — okumak için tıklayın</summary>
        <div className="kvkk-body">
          <p><strong>Veri Sorumlusu:</strong> VizeKontrol.</p>
          <p><strong>İşlenen veriler:</strong> Yüklediğiniz belgeler (pasaport, rezervasyon, banka
          dökümü vb. görsel/PDF içerikleri) ve başvuru formunda verdiğiniz bilgiler (hedef ülke,
          vize türü, çalışma durumu, seyahat tarihleri, masraf karşılayıcı).</p>
          <p><strong>İşleme amacı:</strong> Belgelerinizin başvuru öncesi eksiksizlik, teknik
          uygunluk ve tutarlılık açısından ön kontrolünün yapılması.</p>
          <p><strong>Yurt dışına aktarım:</strong> Belgeleriniz, bu analizi gerçekleştirmek üzere
          Amerika Birleşik Devletleri merkezli yapay zekâ servis sağlayıcısı Anthropic'e (Claude)
          aktarılır. Bu aktarım yalnızca analiz süresi boyunca gerçekleşir; belgeleriniz
          Anthropic tarafında kalıcı olarak saklanmaz.</p>
          <p><strong>Saklama süresi:</strong> Belgeleriniz sistemimizde kalıcı olarak
          saklanmaz; analiz tamamlandığı anda silinir.</p>
          <p><strong>Haklarınız:</strong> 6698 sayılı KVKK'nın 11. maddesi uyarınca
          verilerinizin işlenip işlenmediğini öğrenme, işlenmişse buna ilişkin bilgi talep etme,
          düzeltilmesini veya silinmesini isteme haklarına sahipsiniz.</p>
        </div>
      </details>

      <label className="consent-row">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>
          Belgelerimin yukarıdaki Aydınlatma Metni'nde açıklandığı şekilde işlenmesini ve bu
          amaçla yurt dışındaki bir yapay zekâ servis sağlayıcısına (Anthropic) aktarılmasını
          kabul ediyorum.
        </span>
      </label>

      {turnstileConfigured && (
        <div className="turnstile-wrap" ref={turnstileRef} />
      )}

      {checkError && (
        <div className="form-summary-error" role="alert">
          <AlertTriangle size={16} />
          <p style={{ margin: 0 }}>{checkError}</p>
        </div>
      )}

      <div className="card__actions">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          <ChevronLeft size={16} /> Geri
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!canCheck}
          onClick={onCheck}
          title={!canCheck ? "Devam etmek için en az bir belge yükleyin, onay kutusunu işaretleyin ve doğrulamayı tamamlayın." : undefined}
        >
          Dosyamı kontrol et <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   STEP 2.5 — ANALYZING
------------------------------------------------------------------- */
function Analyzing() {
  return (
    <div className="card card--center">
      <Loader2 size={32} className="spin" />
      <h2 className="card__title" style={{ marginTop: 16 }}>Belgeleriniz kontrol ediliyor…</h2>
      <p className="card__sub">Belge bütünlüğü, teknik uygunluk ve tutarlılık kontrolleri yapılıyor.</p>
    </div>
  );
}

/* ------------------------------------------------------------------
   STEP 3 — RESULT
------------------------------------------------------------------- */
function buildReport(docs, formData) {
  const results = docs.map((doc) => {
    const rule = ANALYSIS_RULES[doc.id] || {};
    if (doc.status === "Yüklenmedi") {
      return { ...doc, status: "Eksik", finding: rule.missing || `${doc.name} yüklenmemiş.` };
    }
    if (rule.review) {
      return { ...doc, status: "İncelenmeli", finding: rule.review };
    }
    return { ...doc, status: "Uygun", finding: rule.ok || `${doc.name} teknik kontrolü karşılıyor.` };
  });

  const total = results.length;
  const uploaded = results.filter((d) => d.status !== "Eksik").length;
  const ok = results.filter((d) => d.status === "Uygun").length;
  const review = results.filter((d) => d.status === "İncelenmeli").length;
  const missing = results.filter((d) => d.status === "Eksik").length;

  const completeness = Math.round((uploaded / total) * 100);
  const technical = uploaded ? Math.round((ok / uploaded) * 100) : 0;
  const consistency = review > 0 ? Math.max(55, 90 - review * 12) : 96;

  const suggestions = [];
  if (formData.employment === "Freelancer / şahıs şirketi sahibi") {
    suggestions.push(SUGGESTIONS_POOL.freelance);
  }
  suggestions.push(SUGGESTIONS_POOL.insuranceRange);
  if (results.some((d) => d.id === "bank")) suggestions.push(SUGGESTIONS_POOL.bankHistory);
  if (review > 0) suggestions.push(SUGGESTIONS_POOL.consistency);

  return {
    results,
    scores: { completeness, technical, consistency },
    groups: {
      critical: results.filter((d) => d.status === "Eksik"),
      review: results.filter((d) => d.status === "İncelenmeli"),
      ok: results.filter((d) => d.status === "Uygun"),
    },
    suggestions: [...new Set(suggestions)],
  };
}

function StepResult({ report, demoMode, formData, onRestart, onBackToDocs }) {
  const country = COUNTRIES.find((c) => c.id === formData.country)?.label || "";

  return (
    <div className="card">
      <div className="report-header">
        <div>
          <h2 className="card__title">Kontrol Sonucu</h2>
          <p className="card__sub">
            {country} · {formData.visaType} vize başvurusu için ön kontrol raporu
          </p>
        </div>
        {demoMode && (
          <span className="demo-badge" title="Gerçek AI servisine ulaşılamadı, örnek veriler gösteriliyor.">
            Demo modu
          </span>
        )}
      </div>

      <div className="scores-row">
        <ScoreDial
          label="Belge tamlık skoru"
          value={report.scores.completeness}
          tone={report.scores.completeness >= 80 ? "good" : "warn"}
        />
        <ScoreDial
          label="Teknik uygunluk skoru"
          value={report.scores.technical}
          tone={report.scores.technical >= 80 ? "good" : "warn"}
        />
        <ScoreDial
          label="Belgeler arası tutarlılık skoru"
          value={report.scores.consistency}
          tone={report.scores.consistency >= 80 ? "good" : "warn"}
        />
      </div>

      <div className="disclaimer">
        <Info size={16} />
        <p>
          Bu rapor yalnızca başvuru öncesi teknik bir kontroldür. Vize başvurusunun kabul
          edileceğini garanti etmez. Nihai karar ilgili konsolosluk veya temsilcilik tarafından
          verilir.
        </p>
      </div>

      {report.groups.critical.length > 0 && (
        <section className="finding-group finding-group--critical">
          <h3><XCircle size={16} /> Kritik eksikler</h3>
          <ul>
            {report.groups.critical.map((d) => (
              <li key={d.id}>{d.finding}</li>
            ))}
          </ul>
        </section>
      )}

      {report.groups.review.length > 0 && (
        <section className="finding-group finding-group--warn">
          <h3><AlertTriangle size={16} /> Düzeltilmesi gerekenler</h3>
          <ul>
            {report.groups.review.map((d) => (
              <li key={d.id}>{d.finding}</li>
            ))}
          </ul>
        </section>
      )}

      {report.groups.ok.length > 0 && (
        <section className="finding-group finding-group--ok">
          <h3><CheckCircle2 size={16} /> Uygun bulunan belgeler</h3>
          <ul>
            {report.groups.ok.map((d) => (
              <li key={d.id}>{d.finding}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="finding-group finding-group--tip">
        <h3><Stamp size={16} /> Öneriler</h3>
        <ul>
          {report.suggestions.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </section>

      <div className="card__actions">
        <button type="button" className="btn btn--ghost" onClick={onBackToDocs}>
          <ChevronLeft size={16} /> Belgelere dön
        </button>
        <button type="button" className="btn btn--primary" onClick={onRestart}>
          Yeni başvuru başlat
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   APP
------------------------------------------------------------------- */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("VizeKontrol render error:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ maxWidth: 640, margin: "40px auto", padding: 24, fontFamily: "sans-serif" }}>
          <h2 style={{ color: "#B42318" }}>Bir hata oluştu</h2>
          <p>Uygulama beklenmedik bir hatayla karşılaştı, bu yüzden ekran güncellenmedi:</p>
          <pre style={{ background: "#FDEDEC", padding: 12, borderRadius: 8, whiteSpace: "pre-wrap" }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 12, padding: "8px 16px", borderRadius: 8, border: "1px solid #ccc", cursor: "pointer" }}
          >
            Tekrar dene
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppInner() {
  const [started, setStarted] = useState(false);
  const [step, setStep] = useState(1);
  const [analyzing, setAnalyzing] = useState(false);
  const [consent, setConsent] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [analysisResult, setAnalysisResult] = useState(null);
  const [demoMode, setDemoMode] = useState(false);
  const [checkError, setCheckError] = useState(null);
  const [paymentRequired, setPaymentRequired] = useState(false);

  const [session, setSession] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // "start" | null
  const [view, setView] = useState("app"); // "app" | "history"
  const [historyReport, setHistoryReport] = useState(null);

  React.useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener?.subscription?.unsubscribe();
  }, []);

  React.useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [started, step, analyzing, view]);

  const [formData, setFormData] = useState({
    country: "",
    visaType: "",
    employment: "",
    startDate: "",
    endDate: "",
    expensePayer: "",
    hasInvitation: "",
  });

  const [docs, setDocs] = useState([]);

  const goHome = () => {
    setStarted(false);
    setStep(1);
    setView("app");
  };

  const startFlow = () => {
    if (!session) {
      setPendingAction("start");
      setShowAuthModal(true);
      return;
    }
    setStarted(true);
    setStep(1);
    setView("app");
  };

  const handleAuthSuccess = () => {
    setShowAuthModal(false);
    if (pendingAction === "start") {
      setStarted(true);
      setStep(1);
      setView("app");
    }
    setPendingAction(null);
  };

  const handleLogout = async () => {
    if (supabase) await supabase.auth.signOut();
    goHome();
  };

  const openHistory = () => {
    if (!session) {
      setShowAuthModal(true);
      return;
    }
    setView("history");
  };

  const handleProfileNext = () => {
    try {
      const checklist = buildChecklist(formData);
      console.log("VizeKontrol: evrak listesi oluşturuldu", checklist);
      setDocs(checklist);
      setConsent(false);
      setStep(2);
    } catch (err) {
      console.error("VizeKontrol: handleProfileNext hata verdi", err);
      throw err;
    }
  };

  const handleCheck = async () => {
    setAnalyzing(true);
    setCheckError(null);
    setPaymentRequired(false);

    try {
      const uploaded = docs.filter((d) => d.status === "Yüklendi" && d.file);
      const documentsPayload = await Promise.all(
        uploaded.map(async (d) => ({
          name: d.name,
          mimeType: d.file.type || guessMimeFromName(d.fileName),
          base64: await fileToBase64(d.file),
        }))
      );

      let authToken = "";
      if (supabase) {
        const { data: sessionData } = await supabase.auth.getSession();
        authToken = sessionData?.session?.access_token || "";
      }

      const res = await fetch(ANALYZE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ formData, documents: documentsPayload, turnstileToken }),
      });

      if (res.status === 404) {
        // Fonksiyon henüz devreye alınmamış (yerel önizleme/deploy edilmemiş) — demo moduna düş.
        console.warn("VizeKontrol: analiz fonksiyonu bulunamadı (404), demo moduna geçiliyor.");
        setAnalysisResult(buildReport(docs, formData));
        setDemoMode(true);
        setStep(3);
        return;
      }

      let data;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (res.status === 401) {
        setCheckError("Oturumunuz sona ermiş görünüyor. Lütfen tekrar giriş yapın.");
        setShowAuthModal(true);
        return;
      }

      if (res.status === 402) {
        setPaymentRequired(true);
        return;
      }

      if (!res.ok) {
        setCheckError(
          ((data && data.error) || "Analiz sırasında bir hata oluştu, lütfen tekrar deneyin.") +
          (data && data.debugDetail ? ` (Detay: ${data.debugDetail})` : "")
        );
        return;
      }

      setAnalysisResult(normalizeApiReport(data));
      setDemoMode(false);
      setStep(3);
    } catch (err) {
      // Ağ hatası, CORS engeli vb. — gerçek backend'e ulaşılamadı, demo moduna düş.
      console.warn("VizeKontrol: gerçek analiz servisine ulaşılamadı, demo moduna geçiliyor.", err);
      setAnalysisResult(buildReport(docs, formData));
      setDemoMode(true);
      setStep(3);
    } finally {
      setAnalyzing(false);
    }
  };

  const restart = () => {
    setFormData({
      country: "",
      visaType: "",
      employment: "",
      startDate: "",
      endDate: "",
      expensePayer: "",
      hasInvitation: "",
    });
    setDocs([]);
    setConsent(false);
    setTurnstileToken("");
    setAnalysisResult(null);
    setDemoMode(false);
    setCheckError(null);
    setPaymentRequired(false);
    setStep(1);
    setStarted(false);
  };

  return (
    <div className="app">
      <style>{`
        ${FONT_IMPORT}

        :root{
          --navy:#6161FF;
          --navy-light:#9450FD;
          --navy-soft:#DBDBFF;
          --bg:#F5F6F8;
          --surface:#FFFFFF;
          --border:#D0D4E4;
          --text:#333333;
          --text-muted:#535768;
          --green:#2A5C4E;
          --green-bg:#BCFE90;
          --amber-icon:#FF8940;
          --amber-text:#8A4B1E;
          --amber-bg:#FFE9DA;
          --red:#B4302A;
          --red-bg:#FFE1E1;
          --mint:#BCFE90;
          --sky:#ABF0FF;
          --lavender:#EDDFF7;
          --periwinkle:#E7ECFF;
          --radius:24px;
          --radius-sm:12px;
          --radius-input:6px;
          --radius-badge:6px;
          --radius-pill:160px;
          --shadow: rgba(205, 208, 223, 0.4) 0px 2px 48px 0px;
        }

        *{ box-sizing:border-box; }
        .app{
          font-family:'Poppins',system-ui,sans-serif;
          background:var(--bg);
          color:var(--text);
          min-height:100%;
          line-height:1.5;
        }
        .app h1,.app h2,.app h3{
          font-family:'Poppins',system-ui,sans-serif;
          font-weight:500;
          color:var(--text);
          margin:0;
        }
        .app :focus-visible{
          outline:2px solid var(--navy-light);
          outline-offset:2px;
        }
        .sr-only{
          position:absolute; width:1px; height:1px; padding:0; margin:-1px;
          overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0;
        }
        @media (prefers-reduced-motion: reduce){
          *{ animation-duration:0.01ms !important; transition-duration:0.01ms !important; }
        }

        /* NAV */
        .nav{ position:sticky; top:0; z-index:20; background:rgba(246,247,249,0.92); backdrop-filter:blur(6px); border-bottom:1px solid var(--border); }
        .nav__inner{ max-width:1100px; margin:0 auto; padding:14px 20px; display:flex; align-items:center; justify-content:space-between; gap:16px; }
        .nav__brand{ display:flex; align-items:center; gap:8px; background:none; border:0; cursor:pointer; padding:0; }
        .nav__logo{ display:flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:9px; background:var(--navy); color:#fff; }
        .nav__brand-text{ font-family:'Poppins',sans-serif; font-weight:700; font-size:17px; color:var(--text); }
        .nav__brand-accent{ color:var(--green); }
        .nav__links{ display:flex; align-items:center; gap:22px; font-size:14.5px; font-weight:600; }
        .nav__links a{ color:var(--text-muted); text-decoration:none; }
        .nav__links a:hover{ color:var(--navy); }
        .nav__login{ background:var(--navy-soft); color:var(--navy); border:1px solid var(--border); padding:8px 16px; border-radius:999px; font-weight:700; cursor:pointer; font-size:14px; }
        .nav__link-btn{ background:none; border:none; color:var(--text-muted); font-weight:600; font-size:14.5px; cursor:pointer; padding:0; }
        .nav__link-btn:hover{ color:var(--navy); }
        .nav__user-email{ font-size:13px; color:var(--text-muted); max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .nav__toggle{ display:none; background:none; border:1px solid var(--border); border-radius:8px; padding:6px; }
        .nav__links--mobile{ display:none; }
        @media (max-width:820px){
          .nav__links--desktop{ display:none; }
          .nav__toggle{ display:flex; }
          .nav__links--mobile{ display:flex; flex-direction:column; align-items:flex-start; gap:14px; padding:16px 20px 20px; border-top:1px solid var(--border); }
        }

        /* HERO */
        .hero{ max-width:1100px; margin:0 auto; padding:56px 20px 40px; display:grid; grid-template-columns:1.15fr 0.85fr; gap:40px; align-items:center; }
        @media (max-width:900px){ .hero{ grid-template-columns:1fr; padding-top:36px; } }
        .hero__eyebrow{ display:inline-flex; align-items:center; gap:6px; font-size:13px; font-weight:700; color:var(--navy-light); background:var(--navy-soft); padding:6px 12px; border-radius:999px; margin:0 0 18px; }
        .hero__headline{ font-size:clamp(30px,4.8vw,52px); font-weight:300; line-height:1.15; letter-spacing:-0.02em; }
        .hero__headline-grad{ background:linear-gradient(90deg,#FE81E4,#FDA900); -webkit-background-clip:text; background-clip:text; color:transparent; }
        .hero__sub{ margin:16px 0 28px; color:var(--text-muted); font-size:16.5px; max-width:46ch; }
        .hero__trust{ list-style:none; padding:0; margin:28px 0 0; display:flex; flex-direction:column; gap:10px; }
        .hero__trust-item{ display:flex; align-items:center; gap:8px; font-size:14px; font-weight:500; padding:10px 16px; border-radius:var(--radius-badge); width:fit-content; }
        .hero__trust-item svg{ flex-shrink:0; }
        .hero__trust-item--mint{ background:var(--mint); color:#173404; }
        .hero__trust-item--sky{ background:var(--sky); color:#042C53; }
        .hero__trust-item--lavender{ background:var(--lavender); color:#3C3489; }

        .hero__panel{ display:flex; justify-content:center; }
        .hero__panel-card{ background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); box-shadow:var(--shadow); padding:22px; width:100%; max-width:340px; display:flex; flex-direction:column; gap:14px; }
        .hero__panel-row{ display:flex; align-items:center; justify-content:space-between; font-size:14px; font-weight:600; padding-bottom:12px; border-bottom:1px dashed var(--border); }
        .hero__panel-stamp{ margin-top:6px; display:flex; flex-direction:column; align-items:center; gap:6px; color:var(--navy-light); border:1.5px dashed var(--navy-light); border-radius:12px; padding:14px; transform:rotate(-2deg); font-size:12.5px; font-weight:700; text-align:center; }

        /* BUTTONS */
        .btn{ display:inline-flex; align-items:center; justify-content:center; gap:8px; font-family:'Poppins',sans-serif; font-weight:500; font-size:14.5px; border-radius:var(--radius-pill); padding:13px 24px; border:1px solid transparent; cursor:pointer; transition:transform .12s ease, background .15s ease, border-color .15s ease; }
        .btn:active{ transform:translateY(1px); }
        .btn--primary{ background:var(--navy); color:#fff; }
        .btn--primary:hover{ background:var(--navy-light); }
        .btn--primary:disabled{ background:#B7C0D1; cursor:not-allowed; }
        .btn--ghost{ background:transparent; color:var(--text); border-color:var(--text-muted); }
        .btn--ghost:hover{ background:var(--navy-soft); }
        .btn--sm{ padding:7px 12px; font-size:13px; }
        .btn--lg{ padding:14px 26px; font-size:16px; }

        /* STEPPER */
        .stepper{ max-width:640px; margin:0 auto 32px; display:flex; align-items:center; padding:0 20px; }
        .stepper__item{ display:flex; flex-direction:column; align-items:center; gap:8px; flex-shrink:0; }
        .stepper__mark{ width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:14px; border:2px solid var(--border); background:var(--surface); color:var(--text-muted); }
        .stepper__mark--active{ border-color:var(--navy); color:var(--navy); background:var(--navy-soft); }
        .stepper__mark--done{ border:2px dashed var(--navy-light); color:var(--navy-light); background:#fff; }
        .stepper__label{ font-size:12.5px; font-weight:600; color:var(--text-muted); white-space:nowrap; }
        .stepper__label--active,.stepper__label--done{ color:var(--navy); }
        .stepper__line{ flex:1; height:2px; background:var(--border); margin:0 8px 22px; }
        .stepper__line--done{ background:var(--navy-light); }
        @media (max-width:520px){ .stepper__label{ display:none; } }

        /* INFO SECTIONS */
        .info-section{ max-width:1100px; margin:0 auto; padding:44px 20px; }
        .info-section--muted{ background:var(--bg); max-width:none; border-radius:0; }
        .info-section--muted > *{ max-width:1060px; margin-left:auto; margin-right:auto; }
        .info-section h2{ font-size:24px; margin-bottom:20px; }
        .info-grid{ display:grid; grid-template-columns:repeat(3,1fr); gap:18px; }
        @media (max-width:800px){ .info-grid{ grid-template-columns:1fr; } }
        .info-card{ background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:20px; }
        .info-grid .info-card:nth-child(1){ background:var(--mint); border:none; }
        .info-grid .info-card:nth-child(2){ background:var(--sky); border:none; }
        .info-grid .info-card:nth-child(3){ background:var(--lavender); border:none; }
        .info-card__num{ display:inline-flex; width:26px; height:26px; align-items:center; justify-content:center; border-radius:8px; background:var(--navy); color:#fff; font-size:13px; font-weight:800; margin-bottom:12px; }
        .info-card h3{ font-size:16px; margin-bottom:6px; }
        .info-card p{ margin:0; color:var(--text-muted); font-size:14px; }
        .security-grid{ display:grid; grid-template-columns:repeat(3,1fr); gap:18px; }
        @media (max-width:800px){ .security-grid{ grid-template-columns:1fr; } }
        .security-item{ display:flex; gap:12px; align-items:flex-start; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:18px; }
        .security-item svg{ color:var(--navy); flex-shrink:0; margin-top:2px; }
        .security-item h3{ font-size:15px; margin:0 0 6px; }
        .security-item p{ margin:0; color:var(--text-muted); font-size:13.5px; }
        .faq details{ background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-sm); padding:14px 16px; margin-bottom:10px; }
        .faq summary{ font-weight:700; cursor:pointer; font-size:15px; }
        .faq p{ margin:10px 0 0; color:var(--text-muted); font-size:14px; }

        /* FLOW WRAPPER */
        .flow{ max-width:760px; margin:0 auto; padding:32px 20px 80px; }

        /* CARD */
        .card{ background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); box-shadow:var(--shadow); padding:28px; }
        .card--center{ text-align:center; padding:60px 28px; color:var(--text); }
        .card__title{ font-size:22px; }
        .card__sub{ color:var(--text-muted); font-size:14.5px; margin:8px 0 24px; }
        .card__actions{ display:flex; justify-content:space-between; margin-top:26px; padding-top:20px; border-top:1px solid var(--border); }
        .card__actions--end{ justify-content:flex-end; }

        /* FORM */
        .form-grid{ display:grid; grid-template-columns:1fr 1fr; gap:18px; }
        @media (max-width:560px){ .form-grid{ grid-template-columns:1fr; } }
        .field{ display:flex; flex-direction:column; gap:6px; }
        .field--full{ grid-column:1 / -1; }
        .field label{ font-size:13.5px; font-weight:500; color:var(--text); }
        .field select, .field input[type="date"]{ font-family:inherit; font-size:14.5px; padding:10px 12px; border-radius:var(--radius-input); border:1px solid var(--border); background:#fff; color:var(--text); }
        .field select:focus, .field input:focus{ border-color:var(--navy-light); }
        .field__err{ color:var(--red); font-size:12.5px; font-weight:600; }
        .field select[aria-invalid="true"], .field input[aria-invalid="true"]{ border-color:var(--red); }
        .form-summary-error{ display:flex; gap:10px; align-items:flex-start; background:var(--red-bg); border:1px solid #F3D2CE; border-radius:var(--radius-sm); padding:14px; margin-bottom:22px; color:var(--red); }
        .form-summary-error__title{ margin:0 0 4px; font-weight:700; font-size:14px; }
        .form-summary-error ul{ margin:0; padding-left:18px; font-size:13.5px; }
        .debug-panel{ margin-top:20px; border:1px dashed var(--border-strong,#B7C0D1); border-radius:var(--radius-sm); padding:12px 14px; background:#FCFCFD; }
        .debug-panel__title{ margin:0 0 6px; font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:.03em; color:var(--text-muted); }
        .debug-panel pre{ margin:0; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12px; white-space:pre-wrap; word-break:break-word; color:var(--text); max-height:220px; overflow:auto; }
        .radio-row{ display:flex; flex-wrap:wrap; gap:8px; }
        .radio-pill{ display:flex; align-items:center; gap:6px; border:1px solid var(--border); border-radius:999px; padding:8px 14px; font-size:13.5px; font-weight:600; cursor:pointer; background:#fff; }
        .radio-pill:has(input:checked){ border-color:var(--navy); background:var(--navy-soft); color:var(--navy); }

        /* DOC LIST */
        .doc-list{ display:flex; flex-direction:column; gap:10px; }
        .doc-row{ display:flex; align-items:center; justify-content:space-between; gap:14px; border:1px solid var(--border); border-radius:var(--radius-sm); padding:14px 16px; flex-wrap:wrap; }
        .doc-row--drag{ border-color:var(--navy-light); background:var(--navy-soft); }
        .doc-row__main{ display:flex; align-items:flex-start; gap:10px; min-width:200px; }
        .doc-row__icon{ color:var(--text-muted); margin-top:2px; flex-shrink:0; }
        .doc-row__name{ margin:0; font-weight:700; font-size:14.5px; }
        .doc-row__source{ margin:2px 0 0; font-size:12px; color:var(--text-muted); }
        .doc-row__right{ display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
        .dropzone{ display:flex; }

        /* CHIPS */
        .chip{ display:inline-flex; align-items:center; gap:5px; font-size:12.5px; font-weight:500; padding:5px 10px; border-radius:var(--radius-badge); white-space:nowrap; }
        .chip--muted{ background:#EEF0F4; color:var(--text-muted); }
        .chip--info{ background:var(--navy-soft); color:var(--navy); }
        .chip--pending{ background:var(--navy-soft); color:var(--navy-light); }
        .chip--ok{ background:var(--green-bg); color:var(--green); }
        .chip--warn{ background:var(--amber-bg); color:var(--amber-text); }
        .chip--bad{ background:var(--red-bg); color:var(--red); }
        .spin{ animation: spin 1s linear infinite; }
        @keyframes spin{ to{ transform:rotate(360deg); } }

        /* PRIVACY / CONSENT */
        .schengen-note{ display:flex; gap:10px; align-items:flex-start; background:var(--navy-soft); border-radius:var(--radius-sm); padding:12px 14px; margin-bottom:20px; color:var(--navy-light); }
        .schengen-note p{ margin:0; font-size:13.5px; color:var(--text); }
        .schengen-note--warn{ background:var(--amber-bg); color:var(--amber-icon); }
        .schengen-note--warn p{ color:var(--amber-text); font-weight:500; }
        .privacy-note{ display:flex; gap:10px; align-items:flex-start; background:var(--navy-soft); border-radius:var(--radius-sm); padding:12px 14px; margin-top:20px; color:var(--navy-light); }
        .privacy-note p{ margin:0; font-size:13.5px; color:var(--text); }
        .kvkk-details{ margin-top:16px; border:1px solid var(--border); border-radius:var(--radius-sm); padding:12px 14px; background:#FCFCFD; }
        .kvkk-details summary{ cursor:pointer; font-size:13px; font-weight:600; color:var(--navy); }
        .kvkk-body{ margin-top:10px; display:flex; flex-direction:column; gap:8px; }
        .kvkk-body p{ margin:0; font-size:12.5px; line-height:1.6; color:var(--text-muted); }
        .kvkk-body strong{ color:var(--text); }
        .consent-row{ display:flex; align-items:flex-start; gap:10px; margin-top:16px; font-size:13.5px; color:var(--text); cursor:pointer; }
        .consent-row input{ margin-top:3px; }

        /* SCORES */
        .scores-row{ display:flex; justify-content:space-around; gap:16px; flex-wrap:wrap; margin:8px 0 24px; }
        .score-dial{ position:relative; width:120px; display:flex; flex-direction:column; align-items:center; }
        .score-dial__svg{ width:100px; height:100px; transform:rotate(-90deg); }
        .score-dial__track{ fill:none; stroke:var(--border); stroke-width:8; }
        .score-dial__fill{ fill:none; stroke-width:8; stroke-linecap:round; transition:stroke-dashoffset .6s ease; }
        .score-dial__value{ position:absolute; top:38px; font-size:20px; font-weight:700; color:var(--text); }
        .score-dial__label{ margin-top:8px; font-size:12px; text-align:center; color:var(--text-muted); font-weight:600; max-width:110px; }

        /* DISCLAIMER */
        .disclaimer{ display:flex; gap:10px; align-items:flex-start; background:var(--amber-bg); border:1px solid #F0DDB0; border-radius:var(--radius-sm); padding:14px; margin-bottom:24px; }
        .disclaimer p{ margin:0; font-size:13.5px; color:var(--amber-text); font-weight:600; }

        /* FINDING GROUPS */
        .finding-group{ margin-bottom:20px; }
        .finding-group h3{ display:flex; align-items:center; gap:8px; font-size:15px; margin-bottom:10px; }
        .finding-group ul{ margin:0; padding-left:0; list-style:none; display:flex; flex-direction:column; gap:8px; }
        .finding-group li{ font-size:14px; padding:10px 12px; border-radius:var(--radius-sm); background:#F8F9FB; border:1px solid var(--border); }
        .finding-group--critical h3{ color:var(--red); }
        .finding-group--critical li{ background:var(--red-bg); border-color:#F3D2CE; color:#7A241A; }
        .finding-group--warn h3{ color:var(--amber-text); }
        .finding-group--warn li{ background:var(--amber-bg); border-color:#F0DDB0; color:var(--amber-text); }
        .finding-group--ok h3{ color:var(--green); }
        .finding-group--ok li{ background:var(--green-bg); border-color:#CFEBDA; color:#155C39; }
        .finding-group--tip h3{ color:var(--navy-light); }

        .report-header{ margin-bottom:18px; display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap; }
        .demo-badge{ font-size:11.5px; font-weight:500; padding:5px 10px; border-radius:var(--radius-badge); background:var(--amber-bg); color:var(--amber-text); white-space:nowrap; }
        .turnstile-wrap{ margin-top:16px; }

        /* AUTH MODAL */
        .modal-overlay{ position:fixed; inset:0; background:rgba(20,20,25,0.45); display:flex; align-items:center; justify-content:center; z-index:50; padding:20px; }
        .modal-card{ position:relative; background:var(--surface); border-radius:var(--radius); box-shadow:var(--shadow); padding:32px; width:100%; max-width:400px; }
        .modal-close{ position:absolute; top:16px; right:16px; background:none; border:none; cursor:pointer; color:var(--text-muted); padding:4px; }
        .auth-form{ display:flex; flex-direction:column; gap:14px; margin-top:18px; }
        .auth-form input{ font-family:inherit; font-size:14.5px; padding:10px 12px; border-radius:var(--radius-input); border:1px solid var(--border); width:100%; }
        .auth-notice{ font-size:13px; color:var(--green); margin:0; }
        .auth-switch{ display:block; width:100%; text-align:center; background:none; border:none; margin-top:16px; color:var(--navy); font-size:13.5px; font-weight:600; cursor:pointer; }

        /* HISTORY */
        .history-list{ display:flex; flex-direction:column; gap:10px; margin-top:8px; }
        .history-item{ display:flex; align-items:center; justify-content:space-between; width:100%; text-align:left; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-sm); padding:14px 16px; cursor:pointer; font-family:inherit; }
        .history-item:hover{ border-color:var(--navy-light); }
        .history-item__title{ margin:0; font-weight:600; font-size:14.5px; }
        .history-item__date{ margin:2px 0 0; font-size:12.5px; color:var(--text-muted); }
      `}</style>

      <NavBar
        onHome={goHome}
        session={session}
        onLoginClick={() => setShowAuthModal(true)}
        onLogout={handleLogout}
        onHistoryClick={openHistory}
      />

      {showAuthModal && (
        <AuthModal onClose={() => { setShowAuthModal(false); setPendingAction(null); }} onSuccess={handleAuthSuccess} />
      )}

      {view === "history" ? (
        historyReport ? (
          <div className="flow">
            <StepResult
              report={normalizeApiReport(historyReport.report_data)}
              demoMode={historyReport.demo_mode}
              formData={historyReport.form_data}
              onRestart={restart}
              onBackToDocs={() => setHistoryReport(null)}
            />
          </div>
        ) : (
          <div className="flow">
            <HistoryView onBack={goHome} onOpenReport={setHistoryReport} />
          </div>
        )
      ) : !started ? (
        <Landing onStart={startFlow} />
      ) : (
        <div className="flow">
          <Stepper step={step} />

          {step === 1 && (
            <StepProfile formData={formData} setFormData={setFormData} onNext={handleProfileNext} />
          )}

          {step === 2 && !analyzing && paymentRequired && (
            <PaymentRequired onBack={() => setPaymentRequired(false)} />
          )}

          {step === 2 && !analyzing && !paymentRequired && (
            <StepDocuments
              docs={docs}
              setDocs={setDocs}
              formData={formData}
              consent={consent}
              setConsent={setConsent}
              onBack={() => setStep(1)}
              onCheck={handleCheck}
              turnstileToken={turnstileToken}
              setTurnstileToken={setTurnstileToken}
              checkError={checkError}
            />
          )}

          {step === 2 && analyzing && <Analyzing />}

          {step === 3 && analysisResult && (
            <StepResult
              report={analysisResult}
              demoMode={demoMode}
              formData={formData}
              onRestart={restart}
              onBackToDocs={() => setStep(2)}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
