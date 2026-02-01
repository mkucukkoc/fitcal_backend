# Avenia Server API – Hızlı Başlangıç (Türkçe)
Bu dosya, 0’dan başlayanlar için uç noktaların ne işe yaradığını, hangi body/başlıkla çağrılacağını ve örnek yanıt akışlarını anlatır. Tüm istekler HTTPS üzerinden yapılmalıdır.

## Ortak Kurallar
- Base URL: `https://<sunucu-domaini>` (örnek verildi, kendi domaininizi kullanın).
- İçerik tipi: `Content-Type: application/json` (aksi belirtilmedikçe).
- Kimlik doğrulama gereken uç noktalarda: `Authorization: Bearer <access_token>`.
- Yanıtlar genelde `application/json` döner; hata durumunda `error` veya `message` alanı olur.

---

## Authentication
### POST /api/v1/auth/register — Yeni kullanıcı kaydı
Body:
```json
{ "email": "user@example.com", "password": "StrongPass123!" }
```
Başarılı yanıt:
```json
{ "accessToken": "...", "refreshToken": "...", "user": { "id": "...", "email": "user@example.com" } }
```

### POST /api/v1/auth/login — Giriş
Body:
```json
{ "email": "user@example.com", "password": "StrongPass123!" }
```
Yanıt: access/refresh token ve kullanıcı bilgisi.

### POST /api/v1/auth/refresh — Access token yenileme
Body:
```json
{ "refreshToken": "..." }
```
Yanıt: yeni `accessToken`.

### POST /api/v1/auth/logout — Mevcut oturumu kapat
Header: `Authorization: Bearer <access_token>`
Yanıt: `{ "success": true }`

### POST /api/v1/auth/logout-all — Tüm cihazlardan çıkış
Header: `Authorization: Bearer <access_token>`
Yanıt: `{ "success": true }`

### GET /api/v1/auth/me — Oturum açan kullanıcı bilgisi
Header: `Authorization: Bearer <access_token>`
Yanıt: `{ "id": "...", "email": "...", ... }`

---

## Email OTP
### POST /api/v1/auth/email/start — OTP iste
Body:
```json
{ "email": "user@example.com" }
```
Yanıt: `{ "success": true }` (kod e-postaya gider).

### POST /api/v1/auth/email/verify — OTP doğrula ve giriş yap
Body:
```json
{ "email": "user@example.com", "code": "123456" }
```
Yanıt: access/refresh token ve kullanıcı bilgisi.

---

## Google Auth
### POST /api/v1/auth/google/start — Google OAuth başlat
Yanıt tipik olarak bir yönlendirme/URL bilgisidir:
```json
{ "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?..." , "statusId": "..." }
```

### GET /api/v1/auth/google/status/{id} — Süreç durumu
Path: `{id}` = start ile dönen statusId  
Yanıt: `{ "status": "pending|success|error", "tokens": {...} }`

### GET /api/v1/auth/google/callback — OAuth callback
Tarayıcı yönlendirmesi için kullanılır; sunucu kod parametresini alıp token üretir.

---

## Apple Auth
### POST /api/v1/auth/apple/start — Apple Sign-In başlat
Yanıt: Apple yönlendirme/URL bilgisi ve `statusId`.

### GET /api/v1/auth/apple/status/{id} — Durum
Yanıt: `{ "status": "pending|success|error", "tokens": {...} }`

### POST /api/v1/auth/apple/callback — Callback
Apple’dan dönen kodla token üretimi yapılır.

---

## Password Reset
### POST /api/v1/auth/password-reset/request — Şifre sıfırlama iste
Body: `{ "email": "user@example.com" }`  
Yanıt: `{ "success": true }` (bağlantı/kod e-postaya gider).

### POST /api/v1/auth/password-reset/confirm — Sıfırlamayı tamamla
Body:
```json
{ "email": "user@example.com", "code": "123456", "newPassword": "NewStrongPass123!" }
```
Yanıt: `{ "success": true }`

---

## PDF Read
### GET /api/v1/pdfread/health — Sağlık kontrolü
Yanıt: `{ "status": "ok", "service": "pdfread" }`

---

## Notifications
### POST /api/v1/notifications/tokens — Push token kaydet
Header: `Authorization: Bearer <access_token>`
Body:
```json
{ "deviceId": "abc123", "token": "expo-or-fcm-token" }
```
Yanıt: `{ "success": true }`

### DELETE /api/v1/notifications/tokens/{deviceId} — Token sil
Header: `Authorization: Bearer <access_token>`
Yanıt: `{ "success": true }`

### POST /api/v1/notifications/send — Tekil bildirim
Header: `Authorization: Bearer <access_token>` (genelde admin yetkisi)
Body:
```json
{ "deviceId": "abc123", "title": "Hello", "body": "World" }
```

### POST /api/v1/notifications/send/bulk — Toplu bildirim
Header: admin auth
Body:
```json
{ "tokens": ["t1","t2"], "title": "Hi", "body": "All" }
```

### GET /api/v1/notifications/stats — İstatistik
Header: `Authorization: Bearer <access_token>` (yetkiye bağlı)
Yanıt örn: `{ "totalSent": 123, "byPlatform": { "ios": 80, "android": 43 } }`

---

## Delete Account (KVKK/GDPR uyumlu)
### POST /api/v1/delete-account — Silme talebi başlat
Header: `Authorization: Bearer <access_token>`
Yanıt: `{ "jobId": "..." }`

### POST /api/v1/delete-account/export — Veri dışa aktarımı
Header: `Authorization: Bearer <access_token>`
Yanıt: dışa aktarım job bilgisi.

### POST /api/v1/delete-account/restore — Geri yükleme (silme süresi içinde)
Header: `Authorization: Bearer <access_token>`
Yanıt: `{ "success": true }`

### GET /api/v1/delete-account/jobs/:jobId — Job durumu
Header: `Authorization: Bearer <access_token>`
Yanıt: `{ "status": "pending|done|failed", ... }`

### GET /api/v1/delete-account/jobs/latest — Son job
Header: `Authorization: Bearer <access_token>`
Yanıt: son job bilgisi.

---

## Premium
### POST /api/v1/premium/customer-info — Premium durum senkronu
Header: `Authorization: Bearer <access_token>`
Body: müşteri/purchase bilgileri (RevenueCat/mağaza’dan gelen).
Yanıt: premium statü güncellemesi.

### POST /api/v1/premium/restore — Satın alımı geri yükle
Header: `Authorization: Bearer <access_token>`
Yanıt: premium statü.

### POST /api/v1/premium/sync — Elle senkron
Header: `Authorization: Bearer <access_token>`
Yanıt: premium statü.

### GET /api/v1/premium/status — Premium durumu
Header: `Authorization: Bearer <access_token>`
Yanıt örn: `{ "isPremium": true, "plan": "monthly", "expiresAt": "2026-01-31T00:00:00Z" }`

---

## Webhooks
### POST /api/v1/webhooks/revenuecat — RevenueCat (v1)
Body: RevenueCat’in gönderdiği event JSON’u. İmza doğrulama yapılabilir.
Yanıt: `{ "received": true }`

### POST /webhooks/revenuecat — Legacy path
Eski endpoint; aynı payload yapısı.

---

## Özet Akış (Tipik Senaryolar)
- Kayıt → /auth/register → token al → /auth/me ile doğrula → premium durumu için /premium/status → bildirim tokenı kaydetmek için /notifications/tokens.
- OTP ile giriş → /auth/email/start → /auth/email/verify → token al → /auth/me.
- Google/Apple → /auth/google|apple/start → status takibi → callback → token → /auth/me.
- Hesap silme → /delete-account → jobId al → /delete-account/jobs/:id ile takip → gerekirse /delete-account/restore.

Bu rehber örnek değerler içerir; gerçek isteklerde geçerli domain, doğru header ve üretim tokenlarını kullanın. Yetki gerektiren uç noktalara uygun rol/izin setiyle istek yapın. 
