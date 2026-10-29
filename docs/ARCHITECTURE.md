# AhiCode Mimari ve Geliştirici Kılavuzu

Bu belge, AhiCode eklentisinin iç mimarisini, dizin yapısını, veri akışını, geliştirici araç zincirini ve test stratejisini detaylandırmaktadır.

---

## 1. Dizin Yapısı

```text
ahi-code/
├── src/
│   ├── extension.ts                  # Aktivasyon, komutlar, view kaydı
│   ├── shared/types.ts               # Extension ↔ webview sözleşmeleri
│   ├── shared/constants.ts           # Paylaşılan sabitler (yollar, zaman aşımları, URL'ler)
│   ├── shared/version.ts             # Sürüm (package.json ile doğrulanır)
│   ├── shared/commandPolicy.ts       # Komut risk politikası (blocked/risky/safe)
│   ├── shared/redaction.ts           # Gizli bilgi maskeleme
│   ├── shared/frontmatter.ts         # YAML frontmatter ayrıştırıcı
│   ├── shared/agents/                # Yerleşik ajan tanımları + rol yönlendirmesi
│   │   ├── index.ts                  # Kayıt defteri (13 rol, alias'lar)
│   │   ├── routing.ts                # Dosya/metin → rol (deterministik)
│   │   ├── params.ts                 # invoke_subagent argüman doğrulama
│   │   └── registry/                 # Rol başına persona + araç listesi
│   ├── shared/editorContext.ts       # Editör bağlamı işaretleri
│   ├── shared/text.ts                # ANSI/temizleme yardımcıları
│   ├── providers/                    # OpenRouter / Ollama / OpenAI uyumlu
│   ├── tools/
│   │   ├── index.ts                  # Araç kayıt defteri (ALL_TOOLS)
│   │   ├── file.ts                   # Dosya araçları (oku/yaz/düzenle/ara/notebook)
│   │   ├── shell.ts                  # Komut, test ve lint çalıştırma
│   │   ├── git.ts                    # Git araçları
│   │   ├── lsp.ts                    # LSP araçları
│   │   ├── knowledge.ts              # Bilgi tabanı ve spec araçları
│   │   ├── agent.ts                  # Alt ajan, plan, doğrulama araçları
│   │   ├── web.ts                    # web_fetch / web_search (SSRF korumalı)
│   │   ├── base.ts                   # Araç tipleri ve argüman doğrulama
│   │   ├── args.ts                   # Argüman yardımcıları
│   │   ├── parsers.ts                # Model çıktısını tipli nesneye çevirme
│   │   └── pathSafety.ts             # Yol hapsi (symlink/traversal koruması)
│   ├── webview/
│   │   ├── SidebarProvider.ts        # Webview yaşam döngüsü ve mesaj dağıtımı
│   │   ├── settingsStore.ts          # Ayar kalıcılığı ve SecretStorage
│   │   ├── modelCatalog.ts           # Sağlayıcı model listesi
│   │   ├── gitChanges.ts             # Değişiklikler ekranı Git sorguları
│   │   ├── apiKeys.ts                # Anahtar maskeleme
│   │   └── webviewHtml.ts            # CSP'li HTML üretimi
│   └── core/
│       ├── agent/
│       │   ├── AgentCore.ts          # Orkestrasyon, onay, iptal
│       │   ├── agentHost.ts          # Denetleyicilerin ortak sözleşmesi
│       │   ├── agentLoop.ts          # ReAct döngüsü ve tur yönetimi
│       │   ├── autonomy.ts           # Otonomi seviyesi ve devam kararı (saf)
│       │   ├── workflowController.ts # Aşama geçişleri ve onay kapıları
│       │   ├── toolPipelineController.ts # Araç kapı zinciri ve yürütme
│       │   ├── verificationController.ts # Doğrulama + onarım döngüsü
│       │   ├── sessionController.ts  # Oturum, iptal, geri alma
│       │   ├── modeTools.ts          # Plan/kod araç kilidi
│       │   ├── turnAssembly.ts       # Sağlayıcı mesaj kurgusu
│       │   ├── terminalExecution.ts  # Tümleşik terminal yürütme
│       │   ├── fileMentions.ts       # @dosya bağlamı
│       │   ├── sessionPersistence.ts # Çok köklü snapshot/checkpoint yönetimi
│       │   └── KnowledgeCurator.ts   # Tembel özetler, LSP zenginleştirme
│       ├── toolRunner.ts             # VS Code'suz araç yürütücü (CLI paylaşır)
│       ├── permission/
│       │   ├── PermissionManager.ts  # allow/deny/autoApprove
│       │   ├── toolPolicy.ts         # Araç onay politikası tablosu
│       │   └── fingerprintApproval.ts# Parmak izi kapsamlı onay (MCP/hook)
│       ├── context/                  # Bağlam penceresi koruması ve pruning
│       ├── memory/                   # Oturum geçmişi + proje hafızası
│       ├── checkpoint/               # Tur checkpoint'leri
│       ├── snapshot/                 # Dosya geri alma
│       ├── mcp/                      # MCP hub + stdio/HTTP client
│       ├── multiagent/               # Alt ajan orkestrasyonu
│       ├── skills/                   # AGENTS.md, skills, özel ajanlar
│       ├── rules/                    # Workspace kuralları (AGENTS.md/.ahirules)
│       ├── lsp/                      # VS Code LSP köprüsü
│       ├── hooks/                    # Pre/Post/Stop hook'ları
│       ├── prompts/                  # Sistem prompt'u
│       ├── routing/                  # Göreve göre model seçimi
│       ├── knowledge/                # Bilgi tabanı + embedding indeksi
│       ├── callgraph/               # Fonksiyon çağrı haritası (LSP tabanlı)
│       ├── spec/                     # Spec deposu (.ahi/specs)
│       ├── workflow/                 # Yönlendirilmiş akış durum makinesi
│       ├── verification/             # Doğrulama + onarım politikası
│       ├── git/                      # Git işlemleri ve komut checkpoint'i
│       ├── worktree/                 # Worktree yalıtımı
│       ├── audit/                    # Hash zincirli denetim günlüğü
│       └── workspace/                # Aktif workspace kökü
├── webview-ui/
│   └── src/
│       ├── App.tsx                   # Ekran yönlendirme
│       ├── index.css                 # Tasarım sistemi: tipografi token'ları, form, buton, yüzey
│       ├── components/               # Sohbet, ayarlar, MCP, ajanlar...
│       ├── components/ui/            # Button, IconButton, TextField, SelectField, Toggle, Card
│       ├── components/Markdown.tsx   # Güvenli markdown renderer
│       ├── utils/vscode.ts           # Webview mesajlaşma
│       └── utils/planProgress.ts     # Plan adımı etiketleri ve renkleri
├── test/unit/                        # Node test runner testleri
├── test/support/                     # Sahte vscode modülü + test yükleme kancası
├── test/e2e/                         # Gerçek VS Code entegrasyon testleri
├── resources/                        # Marka varlıkları (logo.png, logo-dark.png, logo.svg, icon.png, icon.svg, icon-color.svg)
└── esbuild.js                        # Extension bundler
```

---

## 2. ReAct Döngüsü ve Veri Akışı

AhiCode, kullanıcı isteğini alır almaz denetimli bir ReAct (Reasoning + Acting) döngüsü başlatır. Döngü, onay kapıları ve hash zincirli denetim günlüğüyle sıkı şekilde çevrelenmiştir:

```text
Webview UI (React)
   │  postMessage (SEND_MESSAGE / APPROVE_TOOL / CANCEL / ...)
   ▼
SidebarProvider (VS Code WebviewView)
   ▼
AgentCore
   │
   ├── ModelProvider (OpenRouter / Ollama / OpenAI Uyumlu)
   │     └── Streaming SSE + Tool Calls
   │
   ├── ToolPipelineController (Araç Kapı Zinciri)
   │     ├── PermissionManager (Allow / Deny / Approval)
   │     ├── CommandPolicy (Safe / Risky / Blocked denetimi)
   │     └── SnapshotManager (Dosya yazma öncesi otomatik yedek)
   │
   ├── VerificationController (Otomatik Onarım & Doğrulama)
   │     ├── Quick Verification (Tip kontrolü / Lint)
   │     └── End-of-Task Verification (Test süiti koşturma)
   │
   ├── AuditLog (Kriptografik SHA-256 Hash Zinciri)
   │     └── .ahi/audit.log içine değişmez kayıt
   │
   └── TaskState Güncellemeleri → Webview UI
```

---

## 3. Güvenilirlik ve Güvenlik Sözleşmeleri

| Konu                 | Tasarım Tercihi ve Davranış                                                              |
| -------------------- | ---------------------------------------------------------------------------------------- |
| **İptal ve Zaman Aşımı** | Streaming yanıtın tamamı anında iptal edilebilir; 2 dakika veri akışı durursa bağlantı zaman aşımına uğrar. |
| **Token Sayacı**     | Streaming isteklerinde `include_usage` bayrağı ile sağlayıcıdan kesin token sayısı alınır. |
| **Audit Log**        | Komutlar kaydedilirken `Bearer`, `sk-`, `api_key=` gibi hassas anahtar kalıpları maskelenir. |
| **Docker Sandbox**   | Sandbox modu seçiliyse boş imajla ana makineye sessizce düşülmez; hata fırlatılır.        |
| **Editör Bağlamı**   | Yalnızca çalışma alanı **içindeki** aktif dosya ve seçimler prompt bağlamına eklenir.     |
| **Araç Kilidi**      | Plan modunda yazma/komut araçları şemadan çıkarılır; model çağırırsa işlem reddedilir.    |
| **Oturum İzolasyonu**| Yeni oturum başladığında snapshot/checkpoint dizinleri sıfırlanır, oturumlar karışmaz.    |
| **Plan İlerlemesi**  | Başlatılan adım `in_progress` işaretlenir; tur dosya değişikliği ürettiyse adım tamamlanır. |

---

## 4. Geliştirici Scriptleri ve Araç Zinciri

| Komut                          | Açıklama                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `npm run dev`                  | Derler ve yeni bir Extension Host penceresi açar.                            |
| `npm run check`                | Tam kalite kapısı: format + tip + lint + dil + test + kapsam.                |
| `npm run typecheck`            | Extension TypeScript tip kontrolü (`tsc --noEmit`).                          |
| `npm run typecheck:test`       | Test dosyalarının tip kontrolü (`tsconfig.test.json`).                       |
| `npm run lint`                 | ESLint kod kalitesi kontrolü (src, test, scripts).                           |
| `npm run format`               | Prettier ile kod tabanını biçimlendirir.                                     |
| `npm run format:check`         | Biçimlendirmenin bozulmadığını doğrular (CI kapısı).                         |
| `npm test`                     | Çekirdek ve arayüz birim testlerini birlikte çalıştırır.                    |
| `npm run test:ui`              | Yalnızca webview (React) testlerini çalıştırır.                              |
| `npm run test:coverage`        | Node.js yerleşik test kapsam raporunu yazdırır.                              |
| `npm run check:coverage`       | Satır kapsamı eşiğini (%75) doğrular.                                        |
| `npm run check:version`        | `package.json`, lockfile ve `version.ts` tutarlılığını doğrular.             |
| `npm run check:test-isolation` | Testlerin geçici dosyaları `os.tmpdir()` altında tuttuğunu doğrular.         |
| `npm run check:language`       | Ajan dosyalarının (`AGENTS.md`, `.agents/**`) İngilizce ve kaynak kod yorumlarının Türkçe olduğunu doğrular. |
| `npm run build`                | Tüm kapılar + webview derleme + minified extension ve CLI bundle'ı üretir.  |
| `npm run compile`              | Yalnızca extension bundle'ını esbuild ile derler.                            |
| `npm run build:ui`             | Yalnızca webview uygulamasını Vite ile derler.                               |
| `npm run build:cli`            | Yalnızca CLI bundle'ını derler.                                              |
| `npm run package`              | `out/ahi-code-0.0.1.vsix` paketini üretir.                                   |
| `npm run audit:verify`         | `.ahi/audit.log` hash zincirini doğrular (`-- --workspace <path>`).          |
| `npm run cli`                  | Başsız (headless) terminal CLI'ını kaynaktan çalıştırır.                    |
| `npm run test:e2e`             | Derler ve gerçek bir VS Code penceresinde uçtan uca testleri çalıştırır.     |

---

## 5. Arayüz Geliştirme ve Tasarım Sistemi İlkeleri

- **Merkezi Stil Tanımı (`webview-ui/src/index.css`):**
  Tipografi ölçeği (`--ahi-text-*`), kenar yuvarlaklıkları, kontrol yükseklikleri, yüzey renkleri ve kart stilleri tek dosyada toplanmıştır.
- **Yeniden Kullanılabilir UI Bileşenleri (`webview-ui/src/components/ui/`):**
  `Button`, `IconButton`, `TextField`, `SelectField`, `TextareaField`, `Toggle`, `Card`, `Section`, `SectionTitle` ve `EmptyState`.
- **Sert Stil Yasağı:**
  Bileşenler içinde sabit piksel renkleri (`#123456`) veya `text-[9px]` gibi keyfi boyutlar kullanılmaz. Yeni bir ihtiyaçta önce `index.css` semantik değişkeni güncellenir.
- **Doğal Ölçeklenebilirlik:**
  Font boyutları `rem` birimiyle bağlanmıştır; kullanıcının VS Code genel font büyüklüğü değiştikçe arayüz editörle mükemmel oranda ölçeklenir.

---

## 6. Test Mimarisi ve Kapsam

Projede 550'den fazla test bulunmakta olup üç katmanda icra edilir:

1. **Birim Testleri (`test/unit/`):** Node.js yerleşik test runner'ı (`node:test`) ve sahte VS Code köprüsü (`test/support/vscode-stub.ts`) ile harici bağımlılık olmadan milisaniyeler içinde çalışır.
2. **Webview UI Testleri (`webview-ui/test/`):** JSDOM ortamında React Testing Library benzeri yapıyla tüm ekran ve bileşen etkileşimlerini simüle eder.
3. **Uçtan Uca Entegrasyon Testleri (`test/e2e/`):** `@vscode/test-electron` ile gerçek bir VS Code örneği başlatarak uzantının manifest uyumunu, komut kaydını ve ayar senkronizasyonunu denetler.
