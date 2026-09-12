-- VizeKontrol — Supabase veritabanı şeması
--
-- Supabase projenizde: sol menüden "SQL Editor" > "New query" açın,
-- bu dosyanın TAMAMINI yapıştırıp "Run" deyin. Tek seferlik bir kurulumdur.

-- 1) Her kullanıcı için profil satırı: ücretsiz hak kullanıldı mı, kaç kredisi var.
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  free_check_used boolean not null default false,
  credit_balance integer not null default 0,
  created_at timestamptz not null default now()
);

-- 2) Geçmiş kontrol raporları — "Geçmişim" sayfasında listelenecek.
create table if not exists public.reports (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  form_data jsonb not null,
  report_data jsonb not null,
  demo_mode boolean not null default false,
  created_at timestamptz not null default now()
);

-- 3) Ödeme kayıtları — iyzico entegrasyonu bağlandığında kullanılacak.
create table if not exists public.payments (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  amount numeric not null,
  currency text not null default 'TRY',
  status text not null default 'pending',
  provider_ref text,
  created_at timestamptz not null default now()
);

-- Row Level Security: her kullanıcı yalnızca kendi verisini görebilir/yazabilir.
alter table public.profiles enable row level security;
alter table public.reports enable row level security;
alter table public.payments enable row level security;

create policy "Kullanıcı kendi profilini görebilir" on public.profiles
  for select using (auth.uid() = id);

create policy "Kullanıcı kendi raporlarını görebilir" on public.reports
  for select using (auth.uid() = user_id);

create policy "Kullanıcı kendi ödemelerini görebilir" on public.payments
  for select using (auth.uid() = user_id);

-- Not: profiles/reports/payments tablolarına YAZMA işlemleri yalnızca
-- Netlify fonksiyonları üzerinden, "service role" anahtarıyla yapılır
-- (RLS'i atlayan yetkili taraf). Bu yüzden burada insert/update politikası
-- tanımlamıyoruz — bilerek, güvenlik için.

-- Yeni kullanıcı kayıt olduğunda otomatik profil satırı oluşturan tetikleyici.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
