# AhiCode Geliştirici Kılavuzu

**Türkçe** · [English](DEVELOPMENT.md)

Bu belge, AhiCode eklentisine katkı sağlayan, iç mekanizmalarını inceleyen ve yerel ortamda eklentiyi derleyip genişleten geliştiriciler için hazırlanmıştır.

---

## 1. Geliştirme Ortamı Kurulumu

### Gereksinimler
- **Node.js**: v22 veya üzeri
- **npm**: v10 veya üzeri
- **VS Code**: v1.106 veya üzeri (veya VSCodium / Cursor)
- **Git**: 2.30 veya üzeri

### Depoyu Klonlama ve Bağımlılıkları Yükleme
```bash
git clone https://github.com/ysf-bkr/ahi-code.git
cd ahi-code
npm ci
npm --prefix webview-ui ci
```

### Derleme ve Doğrulama Komutları
AhiCode, yüksek kod kalitesi ve test izolasyonu için kapsamlı kontrol scriptlerine sahiptir:

| Komut | Açıklama |
| --- | --- |
| `npm run dev` | Extension'ı derler ve test amaçlı yeni bir VS Code Extension Development Host açar. |
| `npm test` | Çekirdek ve arayüz birim testlerini (`test/unit/**` ve `webview-ui/test/**`) çalıştırır. |
| `npm run test:ui` | Yalnızca webview (React) testlerini JSDOM ortamında çalıştırır. |
| `npm run typecheck` | Extension TypeScript tip kontrolü (`tsc --noEmit`). |
| `npm run typecheck:test` | Test dosyalarının tip kontrolü (`tsconfig.test.json`). |
| `npm run lint` | ESLint ile statik kod analizini çalıştırır. |
| `npm run format` | Prettier ile tüm dosyaları biçimlendirir. |
| `npm run format:check` | Prettier kurallarına uyumu doğrular. |
| `npm run check:version` | `package.json`, lockfile'lar ve `version.ts` sürümlerinin tutarlılığını denetler. |
| `npm run check:test-isolation` | Testlerin geçici dosyaları `os.tmpdir()` altında yalıttığını doğrular. |
| `npm run check:language` | Ajan belgelerinin (`AGENTS.md`, `.agents/**`) İngilizce, kaynak kod yorumlarının Türkçe olduğunu doğrular. |
| `npm run test:coverage` | Node.js yerleşik test kapsam raporunu yazdırır. |
| `npm run check:coverage` | Satır kapsamı eşiğini (%75) doğrular. |
| `npm run check` | Tam kalite kapısı: format + tip + lint + dil + test + kapsam. |
| `npm run package` | `out/ahi-code-0.0.2.vsix` paketini üretir. |
| `npm run install:ext` | VSIX paketini üretip yerel VS Code ortamına kurar/günceller. |

---

## 2. İç Mimari ve Katmanlar

AhiCode modüler ve tek yönlü veri akışına dayalı bir katman mimarisine sahiptir:

```text
src/
├── extension.ts                  # VS Code aktivasyon noktası ve komut kayıtları
├── shared/                       # Webview ve Extension arasında paylaşılan tipler ve sabitler
│   ├── types.ts                  # İki yönlü postMessage protokolü ve veri modelleri
│   ├── constants.ts              # Dizin yolları, zaman aşımları, varsayılan URL'ler
│   ├── version.ts                # Sürüm tek kaynağı (Single source of truth)
│   ├── commandPolicy.ts          # Terminal komut risk analizi (blocked/risky/safe)
│   ├── languageMap.ts            # VS Code söz dizimi renklendirme ve dil haritası
│   └── redaction.ts              # Hassas anahtar/parola maskeleme
├── providers/                    # LLM Sağlayıcı adaptörleri (Ollama, EVREN, OpenRouter, OpenAI)
├── tools/                        # Ajan araçları (dosya, terminal, git, lsp, web)
│   ├── file.ts                   # Dosya okuma, yazma, düzenleme
│   ├── shell.ts                  # Terminal komutu, test ve linter yürütme
│   ├── git.ts                    # Git durumu, diff, log, commit
│   ├── lsp.ts                    # VS Code dil sunucusu (tanılar, tanımlar, semboller)
│   └── pathSafety.ts             # Path traversal ve symlink kaçış koruması
├── webview/                      # Webview yönetimi (SidebarProvider, settingsStore, apiKeys)
└── core/                         # Ajan çekirdeği (ReAct döngüsü, hafıza, denetim, güvenlik)
    ├── agent/                    # AgentCore, AgentLoop, Autonomy, Workflow
    ├── permission/               # İzin yöneticisi ve onay kuralları
    ├── audit/                    # SHA-256 hash zincirli denetim günlüğü
    ├── snapshot/                 # Dosya anlık görüntüleri ve diff geri alma
    ├── checkpoint/               # Tur bazlı durum geri sarma
    ├── callgraph/                # Çağrı haritası ve kod ilişkileri
    └── mcp/                      # Model Context Protocol istemcisi
```

---

## 3. Tasarım Sistemi ve Stil Kuralları

Tüm arayüz değişkenleri, renkler, ölçüler ve bileşen biçimleri `webview-ui/src/index.css` dosyasında merkezi olarak tanımlanmıştır. Bileşenler (`webview-ui/src/components/ui/*`) bu sınıfları birleştirir; JSX içinde ham renk, piksel değeri veya tekrar eden uzun yardımcı sınıf dizisi bulunmaz.

### Tema Uyumu
- Arayüz renkleri kullanıcının VS Code temasından gelir: `--vscode-*` değişkenleri `--ahi-*` jetonlarına eşlenir.
- Gezinti, bağlantı, odak ve birincil düğme renkleri `textLink`, `button`, `focusBorder` gibi tema değişkenlerini kullanır; böylece kırmızı, yeşil ya da yüksek karşıtlıklı bir temada arayüz maviye zorlanmaz.
- Marka paleti (`--primary`, `--secondary`, `--accent`, `--brand-gradient`) yalnızca logo ve tanıtım yüzeylerinde kullanılır.
- Durum renkleri (`--status-*`) tema değişkenlerinden türetilir; açık, koyu ve yüksek karşıtlık temalarında ayrı ayrı doğrulanır.

### Tipografi ve Boyut Ölçeği
- `rem` tabanlı ölçek kullanılarak VS Code genel font boyutuyla uyum sağlanır.
- Metin jetonları: `--ahi-text-2xs` (0.82rem), `--ahi-text-xs` (0.88rem), `--ahi-text-sm` (0.96rem), `--ahi-text-md` (1rem), `--ahi-text-lg` (1.18rem), `--ahi-text-xl` (1.35rem).
- Sohbet gövdesi ve markdown içeriği `--ahi-text-md` üzerinden `ahi-prose` sınıfıyla biçimlenir; markdown başlıkları `ahi-md-h1`…`ahi-md-h6` sınıflarını kullanır.
- Bileşenler tipografiyi `ahi-heading`, `ahi-title`, `ahi-label`, `ahi-caption`, `ahi-overline` sınıflarından alır.

### Simge Ölçeği
- Tüm lucide simgeleri tek ölçekten boyutlanır: `ahi-icon-xs` (12px), `ahi-icon-sm` (14px), `ahi-icon-md` (16px), `ahi-icon-lg` (20px), `ahi-icon-xl` (24px), `ahi-icon-2xl` (32px).
- Simgeler `var(--ahi-icon-*)` değişkenleriyle tanımlandığı için JSX içinde `h-3 w-3` gibi ham boyut sınıfı kullanılmaz.

### Renk Yardımcıları
- Metin: `ahi-text-fg`, `ahi-text-muted`, `ahi-text-brand`, `ahi-text-info`, `ahi-text-success`, `ahi-text-warning`, `ahi-text-error`, `ahi-text-on-accent`.
- Yüzey ve çerçeve: `ahi-bg-base`, `ahi-bg-raised`, `ahi-bg-surface`, `ahi-bg-input`, `ahi-bg-brand-soft`, `ahi-border-base`, `ahi-border-surface`, `ahi-border-brand` ve `ahi-border-{info,success,warning,error}`.
- Durum yüzeyleri: `ahi-bg-{info,success,warning,error}`.
- Ham renk kodu (`#123456`) yerine her zaman `var(--vscode-*)` veya `var(--ahi-*)` kullanılır.

### Yazı Tipleri
- Arayüz metni `var(--vscode-font-family)` devralır.
- Kod, terminal ve tek aralıklı öğeler `var(--vscode-editor-font-family)` ve kullanıcının editör yazı boyutu ayarını kullanır.

### Arayüzde modül haritası
Besteci altındaki `ModuleStrip`, planın üstünde modül haritasını çizer:
modüller katmana göre gruplanır ve alttan üste sıralanır; her satır sahip rolü,
sahip olduğu yolları ve o modüle bağlı plan adımının durumunu gösterir. Plan
onaylanana kadar şeritte `kod öncesi` işareti görünür.

---

## 4. MCP (Model Context Protocol) Desteği

AhiCode, harici geliştirici araçlarını ve veri kaynaklarını dinamik olarak
bağlamak için Model Context Protocol standardını destekler. İstemci
`src/core/mcp/` altında yer alır ve JSON-RPC'yi stdio ya da HTTP/SSE taşıyıcıları
üzerinden konuşur.

### Yapılandırma

Sunucular sırasıyla şu dosyalardan okunur:

1. `.ahi/mcp_config.json` (önerilen)
2. Çalışma alanı kökündeki `mcp_config.json`
3. Çalışma alanı kökündeki `.mcp.json`

Dosya şeması `{ "mcpServers": { "<ad>": { ... } } }` biçimindedir. Bir sunucu
kaydı ya yerel bir süreç ya da uzak bir uç nokta tanımlar:

```json
{
  "mcpServers": {
    "local-tool": {
      "command": "node",
      "args": ["./tools/server.js"],
      "env": { "TOKEN": "<değer>" }
    },
    "remote-tool": {
      "type": "sse",
      "url": "https://example.com/mcp"
    }
  }
}
```

### Güvenlik kuralları

- Sunucuya miras kalan ortam değişkenleri ayıklanır; sır görünümlü değerler
  geçirilmez. Anahtar gerektiren bir sunucuya değer, `env` alanıyla açıkça
  verilmelidir.
- Sunucu komutları makinenizde çalışır; bu yüzden proje MCP sunucuları açık ve
  parmak izi kapsamlı onay gerektirir ve güvenilmeyen çalışma alanında asla
  yüklenmez.
- MCP sunucusuna gönderilen araç argümanları ve çağrının gerektirdiği proje
  verileri makinenizden çıkabilir. Yalnızca güvendiğiniz sunucuları ekleyin.


