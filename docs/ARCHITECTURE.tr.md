# AhiCode Mimari ve Geliştirici Kılavuzu

**Türkçe** | [🇬🇧 English](ARCHITECTURE.md)

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
│   ├── shared/languageMap.ts         # VS Code dil kimliği eşlemesi (söz dizimi renklendirme)
│   ├── shared/diffContentProvider.ts # Paylaşılan diff URI yardımcıları
│   ├── shared/workflowLabels.ts      # Akış aşaması etiketleri
│   ├── shared/redaction.ts           # Gizli bilgi maskeleme
│   ├── shared/frontmatter.ts         # YAML frontmatter ayrıştırıcı
│   ├── shared/agents/                # Yerleşik ajan tanımları + rol yönlendirmesi
│   │   ├── index.ts                  # Kayıt defteri (13 rol, alias'lar)
│   │   ├── routing.ts                # Dosya/metin → rol (deterministik)
│   │   ├── params.ts                 # invoke_subagent argüman doğrulama
│   │   └── registry/                 # Rol başına persona + araç listesi
│   ├── shared/editorContext.ts       # Editör bağlamı işaretleri
│   ├── shared/text.ts                # ANSI/temizleme yardımcıları
│   ├── providers/                    # LLM adaptörleri (Ollama, EVREN, OpenRouter, OpenAI)
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
│   │   ├── diffContentProvider.ts    # Yan yana diff içerik sağlayıcısı
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
│       │   ├── SessionRegistry.ts    # Her sohbet için bir canlı AgentCore (arka plan)
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
│       ├── skills/                   # Yetenek keşfi ve yükleme
│       ├── rules/                    # Workspace kuralları (AGENTS.md/.ahirules)
│       ├── lsp/                      # VS Code LSP köprüsü
│       ├── hooks/                    # Pre/Post/Stop hook'ları
│       ├── prompts/                  # Sistem prompt'u
│       ├── routing/                  # Göreve göre model seçimi
│       ├── knowledge/                # Bilgi tabanı + embedding indeksi
│       ├── callgraph/                # Fonksiyon çağrı haritası (LSP tabanlı)
│       ├── spec/                     # Spec deposu (.ahi/specs)
│       ├── plan/                     # TaskPlanner + ModulePlanner (katmanlı modül haritası)
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
├── resources/                        # Marka varlıkları (logo, simge, favicon türevleri)
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

## 3. Oturumlar ve Arka Plan Çalışması

Bir sohbet görünüm durumu değil, yaşayan bir `AgentCore` örneğidir.

- `SessionRegistry` her sohbet için bir çekirdek tutar. Sohbet değiştirmek
  (ya da yeni sohbet açmak) yalnızca hangi çekirdeğin **etkin** olduğunu
  değiştirir; önceki çekirdek turunu ve alt ajanlarını arka planda sürdürür.
- Tek örnek olması gereken ağır servisler `SharedServices` üzerinden
  paylaşılır (`McpHub`, `LspClient`, `CallGraphManager`, `KnowledgeStore`,
  spec deposu, worktree ve git yöneticileri). Böylece ikinci sohbet yeni bir
  MCP yığını açmaz, indeksi yeniden kurmaz.
- Oturuma özel durum çekirdekte kalır: plan, modül haritası, snapshot'lar,
  checkpoint'ler, doğrulama baseline'ı ve abort denetleyicisi.
- Durum güncellemeleri `sessionKey` ile etiketlenir; arayüz yalnızca etkin
  oturumu çizer, diğer çalışan sohbetleri sohbet alanının üstündeki şeritte
  gösterir.
- Arka plan sohbetleri yalnızca uyarı ve hataları öne çıkarır; alt ajan
  ilerlemesi etkin sohbeti meşgul etmez.
- Bir sohbet silinirken önce çekirdeği kapatılır; silinen oturum kendi kaydını
  geçmişe geri yazamaz.

---

## 4. Güvenilirlik ve Güvenlik Sözleşmeleri

| Konu                 | Tasarım Tercihi ve Davranış                                                              |
| -------------------- | ---------------------------------------------------------------------------------------- |
| **İptal ve Zaman Aşımı** | Streaming yanıtın tamamı anında iptal edilebilir; 2 dakika veri akışı durursa bağlantı zaman aşımına uğrar. |
| **Token Sayacı**     | Streaming isteklerinde `include_usage` bayrağı ile sağlayıcıdan kesin token sayısı alınır. |
| **Audit Log**        | Komutlar kaydedilirken `Bearer`, `sk-`, `api_key=` gibi hassas anahtar kalıpları maskelenir. |
| **Docker Sandbox**   | Sandbox modu seçiliyse boş imajla ana makineye sessizce düşülmez; hata fırlatılır.        |
| **Editör Bağlamı**   | Yalnızca çalışma alanı **içindeki** aktif dosya ve seçimler prompt bağlamına eklenir.     |
| **Araç Kilidi**      | Plan modunda yazma/komut araçları şemadan çıkarılır; model çağırırsa işlem reddedilir.    |
| **Oturum İzolasyonu**| Yeni oturum başladığında snapshot/checkpoint dizinleri sıfırlanır, oturumlar karışmaz.    |
| **Plan İlerlemesi**  | Başlatılan adım `in_progress` işaretlenir; dosya değişikliği, araç etkinliği ya da görev tamamlanması üreten turun sonunda adım tamamlanır. |

---

## 5. Geliştirici Scriptleri ve Araç Zinciri

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
| `npm run package`              | `out/ahi-code-0.0.2.vsix` paketini üretir.                                   |
| `npm run audit:verify`         | `.ahi/audit.log` hash zincirini doğrular (`-- --workspace <path>`).          |
| `npm run cli`                  | Başsız (headless) terminal CLI'ını kaynaktan çalıştırır.                    |
| `npm run test:e2e`             | Derler ve gerçek bir VS Code penceresinde uçtan uca testleri çalıştırır.     |

---

## 6. Endüstriyel Modül Akışı

Kod, plandan doğrudan yazılmaz. Ajan önce katmanlı bir modül haritası kurar;
böylece "ne nereye gidecek" ve "hangi sırayla yazılacak" sorusu tek bir dosyaya
dokunulmadan önce netleşir:

1. **Spec** (`write_spec`) — hedef, kapsam, kapsam dışı, varsayımlar ve kabul
   kriterleri. Onay için kriterler üç boyutu kapsamalıdır: mutlu yol, hata yolu
   ve uç durum.
2. **Modül haritası** (`update_module_plan`) — her modül bir katman
   (`shared`, `domain`, `infrastructure`, `application`, `interface`, `test`,
   `docs`), sahip olduğu yollar, tek cümlelik sorumluluk, bağımlılıklar ve onu
   yazacak uzmanı bildirir. Bağımlılık yönü alana doğrudur; katman ihlalleri ve
   döngüler kod yazılmadan reddedilir.
3. **Plan** (`update_plan`) — adımlar bir `moduleId` ve karşıladıkları kabul
   kriterlerini referanslar. Modül haritası olmayan plan reddedilir.
4. **Uygulama** — modüller katman sırasına göre yazılır (shared → domain →
   infrastructure → application → interface); bir modül yalnızca bağımlı
   olduğu modülleri kullanabilir. Her yazma öncesi snapshot alınır ve diff
   önizlemesi açılır.
5. **Doğrulama** — test, lint ve tip denetimi çalışır. Atlanan doğrulama, bitti
   kapısını yalnızca çalışma alanı hiç yokken tatmin eder; böylece test komutu
   bulunamadığında görev sessizce kapanmaz.

Modül haritası besteci altındaki şeritte görünür; görev çalışırken yazma sırası
ve hangi modülün işlendiği tek bakışta izlenir.

---

## 7. Arayüz Geliştirme ve Tasarım Sistemi İlkeleri

- **Merkezi Stil Tanımı (`webview-ui/src/index.css`):**
  Tipografi ölçeği (`--ahi-text-*`), kenar yuvarlaklıkları, kontrol yükseklikleri, yüzey renkleri ve kart stilleri tek dosyada toplanmıştır.
- **Yeniden Kullanılabilir UI Bileşenleri (`webview-ui/src/components/ui/`):**
  `Button`, `IconButton`, `Input`, `Textarea`, `Select`, `Checkbox`, `TextField`, `SelectField`, `TextareaField`, `SearchField`, `Toggle`, `Card`, `Section`, `SectionTitle`, `EmptyState`, `Badge`, `Chip`, `Segmented`, `ListButton`, `NavButton`, `Disclosure`, `Drawer` ve `Popover`.
- **Sert Stil Yasağı:**
  Bileşenler içinde sabit piksel renkleri (`#123456`) veya `text-[9px]` gibi keyfi boyutlar kullanılmaz. Yeni bir ihtiyaçta önce `index.css` semantik değişkeni güncellenir.
- **Tema Uyumu:**
  Gezinti, bağlantı, odak halkaları ve birincil düğmeler VS Code tema değişkenlerini okur; özel temalar marka mavisine zorlanmaz. Ayrıntılar için [DEVELOPMENT.tr.md](./DEVELOPMENT.tr.md).
- **Doğal Ölçeklenebilirlik:**
  Font boyutları `rem` birimiyle bağlanmıştır; kullanıcının VS Code genel font büyüklüğü değiştikçe arayüz editörle mükemmel oranda ölçeklenir.

---

## 8. Test Mimarisi ve Kapsam

Test süiti hâlihazırda 646 testten (542 çekirdek + 104 webview) oluşur ve üç katmanda icra edilir:

1. **Birim Testleri (`test/unit/`):** Node.js yerleşik test runner'ı (`node:test`) ve sahte VS Code köprüsü (`test/support/vscode-stub.ts`) ile harici bağımlılık olmadan milisaniyeler içinde çalışır.
2. **Webview UI Testleri (`webview-ui/test/`):** JSDOM ortamında React Testing Library benzeri yapıyla tüm ekran ve bileşen etkileşimlerini simüle eder.
3. **Uçtan Uca Entegrasyon Testleri (`test/e2e/`):** `@vscode/test-electron` ile gerçek bir VS Code örneği başlatarak uzantının manifest uyumunu, komut kaydını ve ayar senkronizasyonunu denetler.
