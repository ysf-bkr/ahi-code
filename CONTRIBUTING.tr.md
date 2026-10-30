# AhiCode'a Katkıda Bulunma

> [!NOTE]
> Bu belge Türkçe sürümdür; İngilizce aslı için [CONTRIBUTING.md](./CONTRIBUTING.md).

AhiCode'u geliştirmeye ilgi gösterdiğiniz için teşekkür ederiz. Bu proje, React
webview ve başsız (headless) CLI içeren bir VS Code eklentisidir.

## Ön koşullar

- Node.js 22+
- npm 10+
- VS Code 1.106+

## Kurulum

```bash
npm ci
npm --prefix webview-ui ci
```

## Pull request açmadan önce

Tam doğrulama zincirini çalıştırın:

```bash
npm run build
npm test
```

`npm run build`; sürüm tutarlılık denetimlerini, her iki TypeScript tip
denetimini, ESLint'i, webview derlemesini, eklenti paketini ve CLI paketini
çalıştırır. Adımlardan biri başarısızsa PR açmayın.

Faydalı tekil komutlar:

| Komut | Amaç |
| --- | --- |
| `npm run typecheck` | Eklenti tip denetimi |
| `npm run typecheck:test` | Test tip denetimi |
| `npm run lint` | ESLint |
| `npm test` | Çekirdek + webview testleri |
| `npm run dev` | Extension Development Host penceresi açıp eklentiyi çalıştırır |
| `npm run cli -- --prompt "..."` | Başsız CLI'ı çalıştırır |

## Kod yönergeleri

- Kod modüler ve okunabilir kalsın; TypeScript tip güvenliği önceliklidir.
- Kesinlikle gerekmedikçe dış bağımlılık eklemeyin.
- Tüm araç çağrıları argümanları doğrulamalı ve çalışma alanı yol hapsine uymalıdır.
- İzin/onay akışını asla zayıflatmayın. Yeni araçlar açık bir `requiresApproval`
  kararı ve deny kuralı denetimi gerektirir.
- Sır loglamayın. Denetim günlüğü argümanları anahtar adına göre maskelenir;
  böyle kalsın.
- Davranış değişiklikleri için test ekleyin veya güncelleyin. Güvenlik
  duyarlı değişiklikler regresyon testi gerektirir.

## Dil politikası

- Ajan yönergeleri İngilizce kalır: `AGENTS.md` ve `.agents/**` altındaki tüm
  `.md` dosyaları.
- Proje belgeleri iki dillidir: İngilizce asıl dosyalar (`README.md`,
  `docs/*.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`)
  GitHub/Marketplace otomatik tanıması için standart adlarını korur; Türkçe
  karşılıkları (`*.tr.md`) yanlarında yer alır.
- `CHANGELOG.md`, kod yorumları ve kullanıcıya görünen arayüz (VS Code ayar
  açıklamaları dahil) Türkçedir.
- Kod tanımlayıcıları, testler, loglar ve dosya adları İngilizce kalır; böylece
  araçlar, otomasyon ve güvenlik kanalları tutarlı kalır.
- İki dilli bir çiftin iki tarafını birlikte güncelleyin; çelişki olduğunda
  İngilizce asıl dosya doğruluk kaynağıdır.

## Commit mesajları

`feat:`, `fix:`, `docs:`, `test:`, `chore:` ve `refactor:` gibi conventional
ön ekler kullanın. Konu satırını ~72 karakterin altında tutun; değişiklik
bariz değilse gövdede *neden*i açıklayın.

## Güvenlik sorunları bildirimi

Herkese açık issue açmayın. [SECURITY.tr.md](./SECURITY.tr.md) belgesine bakın.
