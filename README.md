<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./resources/logo-dark.png" />
  <img src="./resources/logo.png" width="420" alt="AhiCode — Yazılım Geliştirme" />
</picture>

# AhiCode

**VS Code içinde çalışan, Ahilik zanaat disipliniyle güçlendirilmiş otonom yazılım geliştirme ajanı.**

> _"Eline, beline, diline sahip ol."_ — Ahilik Zanaat Ahlakı  
> **El (Zanaat):** Titiz kod yazımı ve mimari analiz · **Bel (Şed Kuşağı):** Kırılmaz izin kalkanı ve dizin hapsi · **Dil (Ahlak):** Dürüst durum bildirimi ve hash zincirli denetim.

_Cline veya OpenCode gibi jeneratif araçlardan temel farkı; Türkçe zanaat arayüzü, zorunlu onaylı şartname/plan kapıları, hash zincirli kriptografik denetim günlüğü (`audit.log`) ve yerli model (EVREN) desteğiyle kontrolsüz kod üretimini savunmacı bir mühendislik disiplinine dönüştürmesidir._

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.106-007ACC?logo=visualstudiocode)](https://code.visualstudio.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![CI](https://github.com/ysf-bkr/ahi-code/actions/workflows/ci.yml/badge.svg)](https://github.com/ysf-bkr/ahi-code/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-561%20passing-2ea44f)](./docs/ARCHITECTURE.md)

**Geliştirici:** Yusuf BEKAR · **E-posta:** [ybekar@msn.com](mailto:ybekar@msn.com)

[GitHub deposu](https://github.com/ysf-bkr/ahi-code) · [Hata bildir / özellik iste](https://github.com/ysf-bkr/ahi-code/issues)

</div>

> [!IMPORTANT]
> **Varsayılan olarak yerel çalışır**
>
> AhiCode hiçbir sağlayıcıya bağlı değildir. **Varsayılan sağlayıcı Ollama'dır**: kurulumdan sonra
> API anahtarı olmadan, tamamen kendi makinenizde çalışır. EVREN LLM (SSYZ - evren.ssyz.org.tr), OpenRouter ve OpenAI uyumlu
> uç noktalar isteğe bağlıdır ve yalnızca siz seçtiğinizde kullanılır.

---

## İçindekiler

- [Öne çıkanlar](#öne-çıkanlar)
- [Kurulum](#kurulum)
- [Gizlilik ve veri akışı](#gizlilik-ve-veri-akışı)
- [Hızlı başlangıç](#hızlı-başlangıç)
- [Yönlendirilmiş geliştirme akışı](#yönlendirilmiş-geliştirme-akışı)
- [Bilgi tabanı](#bilgi-tabanı)
  - [Çağrı haritası](#çağrı-haritası)
- [Kodlama ve Planlama modları](#kodlama-ve-planlama-modları)
- [Otonomi: baştan sona kendi başına](#otonomi-baştan-sona-kendi-başına)
- [Ajan orkestrasyonu: kim neyi yapacak](#ajan-orkestrasyonu-kim-neyi-yapacak)
- [Sohbet arayüzü](#sohbet-arayüzü)
- [Tasarım sistemi](#tasarım-sistemi)
- [Araçlar](#araçlar)
- [Token ekonomisi](#token-ekonomisi)
- [Model sağlayıcıları](#model-sağlayıcıları)
- [Ayarlar](#ayarlar)
- [Projeye özel yapılandırma](#projeye-özel-yapılandırma)
- [MCP sunucuları](#mcp-sunucuları)
- [İzinler ve denetim](#izinler-ve-denetim)
- [Hook'lar](#hooklar)
- [Güvenlik modeli](#güvenlik-modeli)
- [VS Code entegrasyonu](#vs-code-entegrasyonu)
- [Mimari ve geliştirici kılavuzu](./docs/ARCHITECTURE.md)
- [Sorun giderme](#sorun-giderme)
- [Destek ve geri bildirim](#destek-ve-geri-bildirim)
- [Sürüm notları](./CHANGELOG.md)
- [Gizlilik bildirimi](./docs/PRIVACY.md)
- [Marketplace yayını](./docs/PUBLISHING.md)
- [Bilinen sınırlar](#bilinen-sınırlar)
- [Katkı](#katkı)
- [Lisans](#lisans)

---

## Öne çıkanlar

| Özellik                     | Açıklama                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Otonom ReAct döngüsü**    | Görevi planlar, araçları çalıştırır, çıktıları değerlendirir ve hedefe ulaşana kadar ilerler.                             |
| **Yönlendirilmiş akış**     | Anlama → sorular → spec onayı → plan onayı → uygulama → doğrulama. Spec ve plan onaylanmadan **hiçbir dosya yazılmaz**.   |
| **Proje bilgi tabanı**      | `.ahi/knowledge/` altında dosya/sembol indeksi, proje gerçekleri, kararlar ve notlar; her görevde projeyi baştan taramaz. |
| **Planlama / Kodlama modu** | Planlama modunda yazma ve komut çalıştırma **teknik olarak kilitlidir**; kodlama modunda tam yetki.                       |
| **Güvenli dosya erişimi**   | Workspace path jail, symlink kontrolü, hassas dosya koruması ve dosya başına izin kuralları.                              |
| **Görsel diff ve onay**     | Yazma/düzenleme işlemleri VS Code diff görünümünde gösterilir; onayınız olmadan diske yazılmaz.                           |
| **Checkpoint / Undo**       | Tur başlangıçlarında checkpoint; dosya değişiklikleri için adım bazlı geri alma.                                          |
| **MCP desteği**             | `.ahi/mcp_config.json` üzerinden stdio ve HTTP/SSE MCP sunucuları.                                                        |
| **AGENTS.md uyumu**         | AGENTS.md, `.agents/skills/` ve `.agents/agents/` yapıları otomatik algılanır.                                            |
| **Proje hafızası**          | Tamamlanan görevler `.ahi/memory.md` dosyasına yazılır; ajan sonraki oturumlarda bunları hatırlar.                        |
| **Alt ajanlar**             | Architect, Coder, Tester, Reviewer ve projeye özel ajanlar.                                                               |
| **LSP entegrasyonu**        | Tanılar, tanıma gitme ve hover bilgisi doğrudan VS Code dil sunucusundan alınır.                                          |
| **Çoklu sağlayıcı**         | EVREN LLM, OpenRouter, Ollama ve OpenAI API uyumlu uç noktalar.                                                           |
| **Güvenli sır saklama**     | API anahtarları `SecretStorage` içinde şifreli tutulur; UI'ya maskeli gönderilir.                                         |
| **Denetim günlüğü**         | Araç kararları `.ahi/audit.log` dosyasına hash zinciriyle yazılır; `npm run audit:verify` ile doğrulanır.                 |
| **Tema uyumu**              | Açık, koyu ve yüksek karşıtlık temalarıyla uyumlu, VS Code değişkenlerine dayalı arayüz.                                  |

---

## Kurulum

### Gereksinimler

- **VS Code 1.106 veya üzeri**
- **Node.js 22+** (yalnızca kaynaktan derleme ve Marketplace paketleme için)
- En az bir model sağlayıcısı:
  - EVREN API anahtarı (SSYZ - https://evren.ssyz.org.tr/)
  - OpenRouter API anahtarı
  - veya yerel [Ollama](https://ollama.com/) kurulumu (varsayılan)

### Marketplace üzerinden kurulum

AhiCode henüz VS Code Marketplace'te yayımlanmadı. Yayın tamamlandığında:

1. VS Code'da **Extensions** görünümünü açın.
2. `AhiCode` veya `ysf-bkr.ahi-code` aratın.
3. Yayıncı kimliğinin `ysf-bkr` olduğunu doğrulayıp **Install**'a tıklayın.

Yayın sonrasında terminalden kurmak için:

```bash
code --install-extension ysf-bkr.ahi-code
```

Marketplace kaydı henüz mevcut olmadığından, bu arama ve komut yayın yapılana kadar çalışmayacaktır.

### VSIX oluşturma ve kurulum

Kaynak depoda dağıtım amaçlı VSIX dosyası tutulmaz. Kendi VSIX paketinizi güncel sürümle oluşturmak için:

```bash
npm run package
```

Bu komut paketi `out/ahi-code-<sürüm>.vsix` konumunda oluşturur. Paketi VS Code'a kurmak veya mevcut kurulumu güncellemek için:

```bash
npm run install:ext
```

Bu komut uzantıyı derler, paketler ve VS Code CLI (`code`) üzerinden kurar. Oluşturduğunuz VSIX'i elle kurmak için:

```bash
code --install-extension out/ahi-code-0.0.1.vsix --force
```

Sürüm yükseldiğinde komuttaki dosya adını güncel sürüme göre değiştirin. Alternatif olarak VS Code içinde **Extensions → ... → Install from VSIX** yolunu izleyebilirsiniz.

### Kaldırma ve güncelleme

Uzantıyı VS Code CLI ile kaldırmak için:

```bash
npm run uninstall:ext
```

VS Code arayüzünden de Extensions bölümünde **AhiCode → Uninstall** seçilebilir.

Şu anda AhiCode Marketplace'te yayımlanmış değil ve GitHub Releases bölümünde yayımlanmış bir sürüm bulunmuyor. Bu nedenle Marketplace üzerinden kurulum ve otomatik güncelleme henüz kullanılamaz. VSIX dosyasından kurulan uzantılarda otomatik güncelleme varsayılan olarak kapalıdır. Yerel VSIX kurulumunu güncellemek için `npm run install:ext` komutunu yeniden çalıştırın.

Marketplace için publisher hesabı, eşleşen `publisher` kimliği ve `VSCE_PAT` gerekir. Yerel yayın
komutu `npm run publish:ext`; GitHub Actions ile sürüm yayınlama adımları
[Marketplace yayın kılavuzunda](https://github.com/ysf-bkr/ahi-code/blob/main/docs/PUBLISHING.md) açıklanmıştır. Marketplace yayını
hazırlanmadan `publisher` kimliğini değiştirmeyin.

### Kaynaktan kurulum

```bash
git clone https://github.com/ysf-bkr/ahi-code.git
cd ahi-code
npm install
npm --prefix webview-ui install
npm run install:ext
```

### Geliştirme modunda çalıştırma

```bash
npm install
npm --prefix webview-ui install
npm run dev
```

Bu komut uzantıyı derler ve yeni bir Extension Host penceresi açar.

---

## Gizlilik ve veri akışı

- Model isteği gönderildiğinde kullanıcının mesajı ve modele sağlanan bağlam, **Ayarlar'da seçilen sağlayıcıya** iletilir. Sağlayıcının kendi veri işleme, saklama ve gizlilik koşulları geçerlidir.
- EVREN sağlayıcısı seçildiğinde istekler `evren-llmapi.ssyz.org.tr` hizmetine gider. OpenRouter ve OpenAI uyumlu sağlayıcılarda istek, yapılandırılan servise gönderilir. Ollama veya uyumlu bir yerel sunucu kullanırken uç noktanın gerçekten yerel ve güvenilir olduğunu doğrulayın.
- Web araması sorguları, yapılandırmanıza göre Tavily, Brave veya DuckDuckGo'ya gönderilir. `web_fetch` açılan URL'ye istek yapar; alınan içerik modele bağlam olarak verilebilir. Yapılandırılmış MCP sunucuları da kendilerine gönderilen araç argümanlarını alabilir.
- Araçların okuyup modele bağlam olarak eklediği dosya içerikleri de sağlayıcıya gönderilebilir. Hassas veya gizli içerikleri göndermeden önce çalışma alanını ve seçili sağlayıcıyı kontrol edin.
- Sağlayıcı API anahtarları VS Code `SecretStorage` içinde tutulur; düz metin ayarlarına yazılmaz.
- EVREN sağlayıcısı ilk model isteğinden önce kullanım koşullarının durumunu kontrol eder. Kullanım koşulları varsayılan olarak kullanıcı adına otomatik kabul edilmez.

---

## Hızlı başlangıç

1. VS Code'da sol activity bar üzerindeki **AhiCode** simgesine tıklayın.
2. **Ayarlar** ekranından sağlayıcınızı ve modelinizi seçin.
3. API anahtarınızı girin (EVREN / OpenRouter) veya Ollama URL'sini doğrulayın.
4. Bir görev yazın:
   - `Projenin mimarisini incele ve eksikleri raporla`
   - `Testleri çalıştır, başarısız olanları düzelt`
   - `src/auth.ts dosyasındaki hata yönetimini iyileştir`
5. Yazma veya komut gerekiyorsa onay kartı çıkar; **Onayla** ya da **Reddet**.
6. Değişiklikleri adım bazlı geri almak için araç kartındaki **Bu adımı geri al** düğmesini kullanın.

---

## Yönlendirilmiş geliştirme akışı

AhiCode, prompt'tan doğrudan kod üretmez. Aşamalar kapılıdır ve her kapı kullanıcı onayı
gerektirir; `ahiCode.autonomy` `guided`/`auto` ise spec ve plan kapıları otomatik geçilir
(güvenlik kapıları yine sorulur). Ayrıntı: [Otonomi](#otonomi-baştan-sona-kendi-başına).

Aşama listesi **moda göre** değişir; planlama modunda kod yazılmadığı için uygulama ve doğrulama
aşamaları hiç görünmez.

```text
Kodlama:   ANLAMA → İSTEK → SPEC → PLAN → UYGULAMA → İNCELEME → DOĞRULAMA → BİTTİ
Planlama:  ANLAMA → İSTEK → İNCELEME → PLAN → BİTTİ
```

| Aşama         | Ne olur                                                                    | Araç kısıtı                |
| ------------- | -------------------------------------------------------------------------- | -------------------------- |
| **Anlama**    | Proje bilgi tabanı kurulur, mimari ve komutlar çıkarılır                   | Salt-okunur, komut kapalı  |
| **İstek**     | Yalnızca bilgi tabanından çıkarılamayan kararlar sorulur (en fazla 8 soru) | Salt-okunur + `write_spec` |
| **Spec**      | Hedef, kapsam, kapsam dışı, varsayımlar ve kabul kriterleri onaya sunulur  | Salt-okunur                |
| **Plan**      | Adımlar, dosyalar, risk etiketi ve test stratejisi onaya sunulur           | Salt-okunur                |
| **Uygulama**  | Küçük adımlarla kod yazılır; hedef dosya önce okunur                       | Tam yetki                  |
| **İnceleme**  | Diff, "neden" açıklaması ve kabul kriteri eşlemesi                         | Tam yetki                  |
| **Doğrulama** | Test/lint/tip sonuçları; kriterler işaretlenir                             | Tam yetki                  |
| **Bitti**     | Tüm kriterler işaretli ve doğrulama geçmiş olmalı                          | —                          |

Kurallar:

- **Spec onaylanmadan plan yapılmaz, plan onaylanmadan kod yazılmaz.** Bu kural prompt'a ek olarak
  araç listesinde ve yürütme katmanında uygulanır (`INTAKE_MODE_TOOLS`).
- Varsayımlar gizlenmez; spec'in **Varsayımlar** listesinde görünür.
- Onay bekleyen spec/plan için arayüzde **onay kartı** çıkar. "Değişiklik iste" ile gerekçe yazıp
  akışı `İstek` aşamasına geri alabilirsiniz.
- Kabul kriterlerinden biri işaretsizken ajan görevi "bitti" ilan edemez.
- Plan onayından sonra aşamalar **otomatik ilerler**: uygulama turu bitince inceleme, ardından
  doğrulama ve koşullar sağlanırsa bitiş. İlerlenemiyorsa akış çubuğunda nedeni yazılır (ör. kabul
  kriteri işaretsiz).
- Planlama modunda plan onayı görevi doğrudan **Bitti** aşamasına taşır; spec zorunlu değildir.
- Mod değiştirildiğinde kod-only bir aşamadaysanız akış otomatik olarak geçerli bir aşamaya taşınır.
- Sohbet alanı **sadedir**: Yalnızca giriş altında **tek bir durum satırı** (`Uygulama · Yanıt bekleniyor…`) yer alır.
- Yazma alanının hemen üstünde **sabit bir blok** (`ComposerDock`) vardır:
  - **Plan çubuğu** — `Projeyi incele · 1/3 adım · %33 · devam ediyor`. Tıklayınca plan adımları
    sırayla, her adımın durumuyla listelenir; tekrar tıklanınca kapanır.
  - **Ajan sorusu** ve **Spec/Plan onay kartı** — kaydırıp kaybolmazlar, her zaman görünür.
- Durum satırı dürüsttür: yanıt bekleniyor/yazılıyor, araç adı, onay bekleniyor, hata (+ yeniden
  gönder), duraklatıldı, tamamlandı.
- Ajan yanıtları **Kopyala** düğmesiyle kopyalanabilir (odaklanınca da görünür, kopyalanınca onay verir).

### Giriş altı durum satırı

Sohbet girişinin hemen altında tek satırlık **dürüst durum** gösterilir:

| Durum                     | Gösterilen                                             |
| ------------------------- | ------------------------------------------------------ |
| Ajan düşünüyor            | `Yanıt bekleniyor…`                                    |
| Metin akıyor              | `Yanıt yazılıyor…`                                     |
| Araç çalışıyor            | `Araç çalışıyor: read_file (2/5)`                      |
| Onay bekliyor             | `Plan onayı bekleniyor — karttaki düğmeleri kullanın.` |
| Hata                      | `Hata: …` + **Yeniden gönder**                         |
| Duraklatıldı / durduruldu | Devam ipucu + **Yeniden gönder**                       |

**Yeniden gönder**, son kullanıcı istemini yeniden yürütür: başarısız asistan turu ve yarım araç
çağrıları silinir, istem çoğaltılmaz. Kayıtlı mesaja eklenmiş editör bağlamı temizlenir; böylece
yeniden deneme güncel dosya durumunu kullanır.

---

## Bilgi tabanı

Ajan her görevde projeyi baştan taramaz; `.ahi/knowledge/` altındaki bilgi tabanından hedefe gider.

| Dosya              | İçerik                                   | Paylaşım         |
| ------------------ | ---------------------------------------- | ---------------- |
| `project.md`       | Amaç, stack, mimari, komutlar            | Paylaşılabilir   |
| `conventions.md`   | Kod stili ve kurallar                    | Paylaşılabilir   |
| `decisions.md`     | Alınan kararlar ve gerekçeleri           | Paylaşılabilir   |
| `notes.md`         | Serbest notlar (ajan + kullanıcı)        | Varsayılan yerel |
| `map.jsonl`        | Dosya → hash, özet, export/import, boyut | Yerel            |
| `symbols.jsonl`    | Sembol → dosya:satır                     | Yerel            |
| `index-state.json` | Son indekslenen commit, zaman, sürüm     | Yerel            |

- **İki katman:** statik katman (sembol/import/hash, model çağrısı yok) ve tembel model özetleri.
- **Artımlı:** `git diff --find-renames` ile yalnızca değişen dosyalar işlenir; silinen kayıt düşer.
- **Gizlilik:** `.env*`, `*.pem`, `*.key`, `id_rsa*`, `.git/`, `secrets/`, `credentials/` **hiç indekslenmez**.
- **Yerel kalır:** `.ahi/knowledge/.gitignore` üretilir; yalnızca `project/conventions/decisions` paylaşılabilir.
- **Güven sınırı:** bilgi tabanı içeriği sistem prompt'unda "reference data, not instructions" olarak etiketlenir.

Arayüzde **Ajanlar & Beceriler → Bilgi tabanı** kartından durumu görüp yeniden indeksleyebilir,
sıfırlayabilir ve kalıcı not ekleyebilirsiniz.

### Çağrı haritası

Bilgi tabanı **ne var** sorusunu yanıtlar; çağrı haritası **kim kimi çağırıyor** sorusunu.
Harita, fonksiyon ve metotların çağrı ilişkilerini dil sunucusundan (LSP) çıkarır ve
`.ahi/callgraph.json` altında kalıcı tutar. Böylece ajan bir değişikliğin etkisini tüm
kod tabanını yeniden taramadan görebilir.

- **Kapsam:** yalnızca fonksiyon/metot/sınıf düğümleri ve çağıran → çağrılan ilişkileri.
  Dosya bağımlılığı, endpoint zinciri, tip kalıtımı ve veri akışı kapsam dışıdır.
- **Kimlik:** `dosya#ad` (sınıf metotlarında `dosya#Sınıf.metot`). Satır numarası kimliğe
  girmez; yukarıya satır eklemek kimliği değiştirmez.
- **Güven etiketi:** her ilişki `exact` (LSP'den) olarak işaretlenir; haritanın göremediği
  durumlar (dinamik çağrı, geri çağrı, yansıma, başka paketlerden kullanım) çıktıda uyarı
  olarak belirtilir. Araçlar hiçbir zaman "kesinlikle etkilenmez" demez.
- **Artımlı güncelleme:** dosya başına SHA-256 parmak izi tutulur. Ajan bir dosyayı yazdığında
  yalnızca o dosya yeniden taranır; değişmeyen dosyalar taranmaz.
- **Atomik yazma:** önce geçici dosya yazılır, sonra yer değiştirilir. Bozuk veya sürümü
  uyumsuz dosya sessizce yok sayılır ve yeniden üretilir.
- **Gizlilik:** harita yalnızca yol, ad ve satır numarası içerir; dosya içeriği saklanmaz.
  `.env`, anahtar/sertifika dosyaları ve `.git` hiç taranmaz.
- **Yerel kalır:** `.ahi/callgraph.json` varsayılan olarak `.gitignore`'dadır; takımla
  paylaşmak isteyen satırı kaldırabilir.
- **Arka plan:** Harita eklenti açılır açılmaz arka planda hazırlanır ve bellekte + diskte
  tutulur. Kullanıcı bir dosyayı kaydettiğinde yalnızca o dosya yeniden taranır; disk yazımı
  kısa bir gecikmeyle seyreltilir. Bu iş **LLM çağrısı yapmaz** — harita dil sunucusundan
  çıkarılır; model tabanlı bir alt ajan hem pahalı hem de uydurma kenarlar üretme riski taşır.
- **Derinlik:** Araçlarda yapay üst sınır yoktur (`depth: 0` = tüm grafik). Gezinme iterative
  olduğu için derinlik yığın taşması üretmez.
- **Kapatma:** `ahiCode.callGraphEnabled = false` ile özellik tamamen kapatılır; araçlar
  "kapalı" cevabı verir ve ajan eski yönteme (arama, dosya okuma) döner.

Haritayı kullanan salt-okunur araçlar plan modunda da açıktır: `get_callers`, `get_callees`,
`call_graph_impact`, `find_related_code` ve `call_graph_status`. Ajan bir fonksiyonun imzasını
değiştirdiğinde çağıranlarını bu araçlarla bulur ve yapılacaklar listesine ekler.

---

## Kodlama ve Planlama modları

Header üzerindeki mod seçici ile geçiş yapılır. Mod değişikliği ajan çalışırken kilitlidir.

### Planlama modu (`plan`)

Amaç: kod tabanını anlamak ve uygulanabilir bir plan üretmek.

- Yalnızca salt-okunur araçlar modele sunulur.
- `write_file`, `edit_file`, `execute_command`, `run_tests`, `run_linter`, `undo_change` ve MCP yazma araçları **teknik olarak kilitlidir**.
- Sistem prompt'u ajanı yalnızca analiz ve plan üretmeye yönlendirir.

Plan modunda izin verilen araçlar:

```text
read_file, list_directory, search_files, git_status, git_diff,
get_diagnostics, get_definition, get_hover, read_skill, ask_followup_question,
get_project_knowledge, search_memory, add_knowledge_note, write_spec
```

> `write_spec` yalnızca `.ahi/specs/` altına yazar; proje kaynak dosyalarına dokunmaz.
> Bu nedenle planlama ve istek aşamalarında da açıktır.

### Kodlama modu (`code`)

Amaç: görevi baştan sona uygulamak.

- Tüm yerleşik ve MCP araçları kullanılabilir.
- Dosya değişiklikleri snapshot/checkpoint ve audit kapsamındadır.
- Onay gerektiren işlemler `autoApprove` ayarlarına ve `.ahi/permissions.json` kurallarına göre belirlenir.

### Mod garantileri

- Mod yalnızca arayüzde değil, **araç listesi ve yürütme katmanında** uygulanır.
- Mod bilgisi oturumla birlikte saklanır ve yeniden yüklendiğinde korunur.
- Mod kilidi ile **akış kilidi** birlikte uygulanır: planlama modu her zaman kısıtlar,
  kodlama modunda ise spec/plan onayına kadar yazma araçları kapalıdır.

---

## Otonomi: baştan sona kendi başına

`ahiCode.autonomy` ajanın ne kadar kendi başına ilerleyeceğini belirler. Varsayılan
`manual`dır; hiçbir davranış kullanıcı istemeden değişmez.

| Seviye   | Spec/plan onayı     | Tur sonu                 | Yazma/komut izni    |
| -------- | ------------------- | ------------------------ | ------------------- |
| `manual` | Kullanıcıya sorulur | Durdurur                 | Kullanıcıya sorulur |
| `guided` | Otomatik geçilir    | Durdurur                 | Kullanıcıya sorulur |
| `auto`   | Otomatik geçilir    | Görev bitene kadar sürer | Kullanıcıya sorulur |

- Otonomi yalnızca **akış** duraklamalarını kaldırır. Dosya yazma, komut çalıştırma,
  riskli komut engeli, hassas dosya korumaları ve `.ahi/permissions.json` kuralları
  her seviyede aynıdır.
- `guided` ve `auto` modda ek olarak şunlar akışı durdurmaz:
  - **Görev devri** (`invoke_subagent`, `run_parallel_tasks`): alt ajanın kendi
    yazma/komut işlemleri yine onaya tabidir.
  - **Netleştirme sorusu** (`ask_followup_question`): soru görünür, ajan en makul
    varsayımla ilerler ve varsayımı spec'in `assumptions` alanına yazmakla yükümlüdür.
  - **Görev sonu bilgi kaydı** turu atlanır (bilgi dosyası yazımı `always` onay ister).
- `auto` modda otomatik devam sayısı sınırlıdır (`MAX_AUTO_CONTINUATIONS = 12`).
  Sınıra ulaşıldığında ajan durur ve bunu dürüstçe bildirir; sonsuz döngü olmaz.
- Kullanıcı görevi iptal ederse bekleyen otomatik devam turu çalışmaz.
- `guided` ve `auto` modda spec/plan yine üretilir ve görünür; yalnızca onay kartı beklemez.
- Sistem prompt'u seviyeye göre değişir: `manual` "onay bekle" der, otonom modlar
  "onay otomatik verildi, durma" der. İkisi asla çelişmez.

---

## Ajan orkestrasyonu: kim neyi yapacak

İki karar katmanı vardır ve ikisi de deterministiktir:

1. **Rol ataması** (`src/shared/agents/routing.ts`): plan adımının dosyalarına, sonra
   görev metnine, en son varsayılana bakılarak rol seçilir. Model `ownerRole` verdiyse
   o korunur. Aynı girdi her zaman aynı rolü üretir.
2. **Delegasyon** (`invoke_subagent`, `run_parallel_tasks`): yalnızca `manager` rolü
   delege edebilir. Diğer rollerin araç listesinde bu araçlar yoktur; çağrılırsa
   "not allowed to use tool" hatası döner.

Adım → rol örnekleri:

| Dosya / metin                         | Rol        |
| ------------------------------------- | ---------- |
| `webview-ui/src/**/*.tsx`, `.css`     | `frontend` |
| `db/migrations/**`, `*.sql`           | `database` |
| `Dockerfile`, `.github/workflows/**`  | `devops`   |
| `test/**`, `*.spec.ts`, lint ayarları | `quality`  |
| `src/security/**`, "kimlik doğrulama" | `security` |
| `*.rs`, `*.go`, `*.c`                 | `native`   |

Plan onaylandığında roller plana yazılır; arayüz ve sistem prompt'u
`Owner: @rol` olarak gösterir. Rol atamasının kaynağı (`model` / `yönlendirme`)
`ownerRoleSource` alanında saklanır.

Delegasyonun yetki sınırı:

- Ana ajanın `invoke_subagent` çağrısı için verdiği onay **yalnızca delege
  etme** iznidir; alt ajanın yazma/komut izni değildir. Alt ajan yazmaya
  çalışırsa aynı onay kuralı yine uygulanır.
- Alt ajanlar kullanıcıya soramaz. Onay gereken işi yapamazlar; sonucu ana
  ajana "Approval Required" olarak bildirirler.
- İç içe delege en fazla 2 seviyedir: yönetici kendi alt ajanını çağırabilir
  ama sonsuz zincir kuramaz. Sınır aşılırsa çağrı `maxDepth` hatasıyla döner.

> Araç listeleri tek kaynaktır: `src/shared/agents/registry/*.ts` içindeki `tools`
> alanı `ToolName` birleşimine göre derlenir ve `SubagentManager` doğrudan bunu
> kullanır. Bilinmeyen bir araç adı `architecture.test.ts` tarafından yakalanır.

---

## Sohbet arayüzü

- **Markdown yanıtlar:** başlıklar, listeler, alıntılar, kalın/italik, satır içi kod ve kod blokları güvenli biçimde render edilir.
- **Kod blokları:** dil etiketi ve tek tıkla kopyalama.
- **Mesaj kartları:** kullanıcı mesajının altında zaman damgası ve **Kopyala / Düzenle / Geri al** eylemleri;
  "Geri al" o mesajdan sonra yapılan değişiklikleri ilgili checkpoint'e döndürür.
- **Araç zaman çizelgesi:** her araç çağrısı için ikon, kısa açıklama, durum, çıktı, hata ve parametreler.
- **Onay kartı:** yazma/komut işlemleri için diff ve açıklama ile Onayla/Reddet.
- **Soru kartı:** ajan `ask_followup_question` kullandığında girilen cevap aynı görevde devam eder.
- **Checkpoint menüsü:** önceki turlara dönme ve son dosya değişikliğini geri alma.
- **Canlı durum:** adım sayısı, token kullanımı, değiştirilen dosya sayısı.
- **Erişilebilirlik:** metin seçimi, klavye ile gönderme (`Enter`), yeni satır (`Shift+Enter`) ve odak halkaları.

### Ekranlar

| Ekran             | İçerik                                                                |
| ----------------- | --------------------------------------------------------------------- |
| **Sohbet**        | Mesajlar, araç adımları, onaylar, sorular, checkpoint'ler             |
| **Değişiklikler** | Çalışma ağacı Git durumu, dosya farkları, anlık görüntü geri alımları |
| **Geçmiş**        | Kayıtlı oturumlar, arama, durum bilgisi, silme                        |
| **Ajanlar**       | AGENTS.md, proje hafızası, beceriler, özel ve yerleşik alt ajanlar    |
| **MCP**           | Sunucu durumları, keşfedilen araçlar, yapılandırma                    |
| **Ayarlar**       | Sağlayıcı/model, API anahtarı, otomatik izinler                       |
| **Hakkında**      | Sürüm, ortam, özellikler, kısayollar, lisans ve bağlantılar           |

---

## Tasarım sistemi

Arayüzün tamamı tek bir token kaynağından beslenir; bileşenler ham renk veya piksel
yazmaz. Böylece VS Code teması, kullanıcının editör yazı tipi boyutu ve yüksek
karşıtlık modu ayrı ayrı ele alınmak zorunda kalmaz.

### Tipografi

| Token            | Varsayılan | Kullanım                             |
| ---------------- | ---------- | ------------------------------------ |
| `--ahi-text-2xs` | `0.75rem`  | Rozet, zaman damgası, yardımcı metin |
| `--ahi-text-xs`  | `0.85rem`  | Gövde metni, buton, liste satırları  |
| `--ahi-text-sm`  | `0.92rem`  | Bölüm başlıkları                     |
| `--ahi-text-md`  | `1rem`     | Sayfa başlıkları                     |

- Boyutlar `rem` cinsindendir: webview kök yazı tipi kullanıcının VS Code ayarıdır,
  bu yüzden arayüz editörle aynı oranda büyür (`0.75em × 0.92em` çarpım kayması olmaz).
- Tek bir adlandırma şeması vardır: Tailwind `text-2xs` … `text-base` yardımcı
  sınıfları doğrudan token'lara bağlanır. Okunabilirliği korumak için `2xs`'ten (10 px) küçük boyut kullanılmaz.
- Renkler `--ahi-brand-*` (çini mavisi, Selçuklu turkuazı, zanaat altını/bakırı) ve `--vscode-*` değişkenlerinden gelir;
  hata durumu marka renginden daha parlak bir kırmızı kullanır.

### Paylaşılan sabitler

`src/shared/constants.ts` tek kaynaktır. İki veya daha fazla modülün kullandığı bir
değer oraya taşınır; hiçbir dosya kendi kopyasını tutmaz.

| Sabit                                   | Kapsam                                               |
| --------------------------------------- | ---------------------------------------------------- |
| `AHI_DIR`, `AHI_SUBDIRS`, `AHI_FILES`   | `.ahi/` yol ve dosya adları                          |
| `MAX_TOOL_OUTPUT_CHARS`                 | Araç çıktısı üst sınırı (15.000 karakter)            |
| `COMMAND_TIMEOUT_MS`                    | Komut yürütme zaman aşımı (120 sn)                   |
| `HTTP_TIMEOUT_MS`                       | Ağ istekleri (`web`, `modelList`)                    |
| `DEFAULT_PROVIDER_URLS`                 | OpenRouter / Ollama / LM Studio varsayılan adresleri |
| `CLIENT_NAME`, `USER_AGENT`, `REPO_URL` | Tanıtım başlıkları ve istemci adı                    |

`USER_AGENT` sürümü `version.ts` üzerinden okur; sabit bir sürüm dizesi yazılmaz.

### Marka varlıkları

| Dosya                                | Amaç                                                       |
| ------------------------------------ | ---------------------------------------------------------- |
| `resources/logo.png`                 | Ana logo, açık tema (kırpılmış, saydam)                    |
| `resources/logo-dark.png`            | Ana logo, koyu tema (yazı açık renge çevrilmiş, saydam)    |
| `resources/logo.svg`                 | Ana logonun vektör sarmalayıcısı (baskı/tasarım için)      |
| `resources/icon.png`                 | Marketplace simgesi (128×128, kare, saydam)                |
| `resources/icon-color.svg`           | Renkli A markasının vektör kaynağı                         |
| `resources/icon.svg`                 | Aktivite çubuğu için monokrom sürüm (tema rengini alır)    |
| `webview-ui/src/components/Logo.tsx` | Arayüz içi logo bileşeni; aynı marka geometrisini kullanır |

README başlığı, `<picture>` ile tema duyarlı seçim yapar: koyu temada `logo-dark.png`,
açık temada `logo.png` gösterilir. Böylece logodaki koyu lacivert yazı hiçbir temada
kaybolmaz. Logolardaki saydam kenar boşlukları kırpılmıştır; görsel oranı korunur.

---

## Araçlar

| Araç                                                 | Açıklama                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `read_file`                                          | Satır aralığı destekli dosya okuma; ikili dosya ve boyut kontrolü.                                     |
| `write_file`                                         | Yeni dosya oluşturma veya tamamen güncelleme.                                                          |
| `update_acceptance_criteria`                         | Spec kabul kriterlerini işaretler; tümü işaretlenmeden görev "Bitti" olamaz.                           |
| `edit_file`                                          | Benzersiz hedef metin değiştirme; çoklu eşleşme koruması ve `allowMultiple`.                           |
| `list_directory`                                     | Dizin listeleme; `node_modules`, `.git`, `dist` gibi gürültülü klasörleri atlar.                       |
| `search_files`                                       | Metin arama; grep yoksa Node tabanlı yedek arama (cross-platform).                                     |
| `execute_command`                                    | Terminal komutu çalıştırma; risk politikası, iptal edilebilir süreç ve çıktı sınırı.                   |
| `run_tests`                                          | npm/pnpm/yarn/pytest test komutunu otomatik algılar.                                                   |
| `run_linter`                                         | `package.json` lint betiğini veya `tsc` kontrolünü çalıştırır.                                         |
| `git_status`                                         | Git çalışma ağacı durumu.                                                                              |
| `git_diff`                                           | Değişiklik farkı.                                                                                      |
| `get_diagnostics`                                    | LSP hata ve uyarıları.                                                                                 |
| `get_definition`                                     | Sembol tanımına gitme.                                                                                 |
| `get_hover`                                          | Sembol tipi/dokümantasyonu.                                                                            |
| `read_skill`                                         | `.agents/skills/` altındaki beceri talimatları.                                                        |
| `invoke_subagent`                                    | Uzman alt ajana görev devri. `isolate: true` ile ayrı Git worktree üzerinde çalışır.                   |
| `ask_followup_question`                              | Kullanıcıdan cevap bekleyerek görevi duraklatma.                                                       |
| `update_plan`                                        | Bağımlılıklı ve tamamlanma koşullu görev planı oluşturma/güncelleme.                                   |
| `run_verification`                                   | Test, lint ve tip kontrolünü birlikte çalıştırıp sonucu raporlama.                                     |
| `index_workspace` / `find_symbol` / `analyze_impact` | Proje bilgi tabanını kurar; sembol arama ve etki analizi bu indeks üzerinden çalışır.                  |
| `get_project_knowledge`                              | Bilgi tabanı: dosya/sembol sayısı, proje gerçekleri, kurallar, kararlar, modül özetleri, notlar.       |
| `add_knowledge_note`                                 | Bilgi tabanına kalıcı not ekler (`.ahi/knowledge/notes.md`). Onay ister.                               |
| `write_knowledge_file`                               | `project.md`, `conventions.md` veya `decisions.md` içeriğini önerir; onaydan sonra her isteme girer.   |
| `write_spec`                                         | Görev spec'i oluşturur (hedef, kapsam, kapsam dışı, varsayımlar, kabul kriterleri, risk). Onay bekler. |
| `get_references` / `get_workspace_symbols`           | LSP referansları ve workspace sembol araması.                                                          |
| `git_create_branch` / `git_commit` / `prepare_pr`    | Dal, commit ve PR açıklaması hazırlama.                                                                |
| `web_fetch` / `web_search`                           | Güvenli web içeriği ve DuckDuckGo araması.                                                             |
| `search_memory`                                      | Proje hafızası **ve** bilgi tabanında birlikte arama.                                                  |
| `read_notebook`                                      | Jupyter notebook hücrelerini okuma.                                                                    |
| `run_parallel_tasks` / `merge_worktree`              | Worktree’lerde paralel ajan ve birleştirme.                                                            |
| `undo_change`                                        | Son dosya değişikliğini geri alma.                                                                     |
| `get_callers`                                        | Bir sembolü çağıran fonksiyonları derinliğe göre listeler. Salt-okunur.                                |
| `get_callees`                                        | Bir sembolün çağırdıklarını listeler; proje dışı çağrı sayısını ayrıca verir. Salt-okunur.             |
| `call_graph_impact`                                  | Sembol kümesi için etkilenen fonksiyon, dosya ve testleri bulur. Salt-okunur.                          |
| `find_related_code`                                  | Anahtar kelimeyle ilgili başlangıç düğümlerini ve bir seviye çevresini bulur. Salt-okunur.             |
| `call_graph_status`                                  | Harita durumu: son güncelleme, düğüm/ilişki sayısı, eksik dosyalar. Salt-okunur.                       |
| `mcp_*`                                              | MCP sunucularından gelen dinamik araçlar.                                                              |

### Otomatik doğrulama

`ahiCode.autoVerify` açıkken (varsayılan) ajan her dosya değişikliğinden sonra `run_verification`
ile test/lint/tip kontrolünü çalıştırır. Otomatik doğrulama yalnızca **güvenilir çalışma alanında**,
deny kurallarına takılmayan ve `autoApprove.executeCommands` anahtarı açıkken (varsa
`allow.commands` filtresine uyan) komutlarla çalışır; aksi halde komut atlanır ve bilgi bildirimi
gösterilir. Başarısız olursa çıktı
modele geri bildirilir ve `ahiCode.maxRepairAttempts` kadar düzeltme denenir.
`ahiCode.captureBaseline` ile görev başlangıcındaki hatalar `.ahi/verification-baseline.json`
dosyasına kaydedilir; yalnızca yeni regresyonlar düzeltilmeye çalışılır.

Checkpoint ve snapshot'lar `.ahi/checkpoints/` ile `.ahi/snapshots/` altında kalıcıdır;
eklenti yeniden yüklense bile geri alma çalışır. Oturum değiştirmek bu kayıtları silmez.
Tamamlanan dosya değişikliklerinde araç kartındaki **Diff** düğmesi önce/sonra görünümünü açar.

Alt ajanlar, kullanıcı onayı gerektiren yazma/komut işlemlerini doğrudan yapamaz; ana ajanın
onay akışına yönlendirilir.

### Docker sandbox

`ahiCode.sandboxMode = "docker"` ile test/lint/terminal komutları Docker konteynerinde çalışır.
Varsayılan olarak ağ kapalıdır (`ahiCode.sandboxNetwork = false`). İmaj `ahiCode.sandboxImage`
ile belirlenir. Docker kurulu değilse komut açık bir hata ile durur; sessizce host'a düşmez.

### Headless CLI

```bash
npm run cli -- --prompt "Login hatasını düzelt" --workspace . --yes
npm run cli -- --prompt "Projeyi incele" --read-only
```

Varsayılan olarak yazma/komut işlemleri için onay ister. `--yes` ile otomatik onay,
`--read-only` ile yalnızca salt-okunur araçlar kullanılır. CLI'de Workspace Trust arayüzü olmadığı için
depodaki `.ahi/permissions.json` dosyasının `allow`/`autoApprove` kuralları yalnızca `--yes` verildiğinde
dikkate alınır; aksi halde global ayarlar ve onay soruları geçerlidir. API anahtarı `--api-key` veya
`OPENROUTER_API_KEY` ya da OpenAI uyumlu uç nokta için
`OPENAI_COMPATIBLE_API_KEY` ortam değişkeniyle verilir. `--api-key` shell geçmişinde ve süreç listesinde
görünebildiği için ortam değişkeni tercih edilmelidir. OpenAI uyumlu uç nokta
`OPENAI_COMPATIBLE_BASE_URL` ile yapılandırılır.

| Bayrak                | Açıklama                                                  |
| --------------------- | --------------------------------------------------------- |
| `--prompt <metin>`    | Çalıştırılacak görev (zorunlu).                           |
| `--workspace <yol>`   | Çalışma alanı kökü (varsayılan: geçerli dizin).           |
| `--yes`               | Yazma/komut onaylarını otomatik kabul et.                 |
| `--read-only`         | Yalnızca salt-okunur araçları kullan.                     |
| `--provider <ad>`     | `evren`, `openrouter`, `ollama` veya `openai-compatible`. |
| `--model <kimlik>`    | Kullanılacak model kimliği.                               |
| `--max-steps <n>`     | En fazla ajan adımı.                                      |
| `--api-key <anahtar>` | Sağlayıcı API anahtarı (ortam değişkeni tercih edilir).   |
| `--help`              | Kullanım bilgisini yazdırır.                              |

### Proje hafızası 2.0

Görev kayıtları `.ahi/memory.md` yanında `.ahi/memory.jsonl` olarak da saklanır.
Kayıtlar commit, dosya, özet ve zaman bilgisi içerir; `search_memory` ile aranabilir.

### Çoklu kök (multi-root)

Bir oturumda farklı workspace kökleri arasında geçiş yapıldığında her kökün snapshot/checkpoint
kayıtları bellekte ayrı tutulur ve aktif köke göre yüklenir. Eski kökün diskteki kayıtları silinmez.

Tüm araç çağrıları zorunlu parametre doğrulamasından geçer. Hatalar modele yapılandırılmış biçimde döndürülür.

---

## Token ekonomisi

Uzun görevlerde maliyetin çoğu, her adımda tüm geçmişin yeniden gönderilmesinden gelir.
Bu proje dört kaldıraç uygular:

| Kaldıraç                     | Ne yapar                                                                      | Ölçülen etki (25 adımlık görev)         |
| ---------------------------- | ----------------------------------------------------------------------------- | --------------------------------------- |
| **Araç başına çıktı sınırı** | `search_files` 3K, `execute_command` 4K, `read_file` 12K karakter             | ~%55 daha az token                      |
| **Akıllı kesme**             | Başı, sonu ve ortadaki hata satırlarını korur; ham log yerine sinyal gönderir | Kesme kalitesi artar, adım sayısı düşer |
| **Erken geçmiş özetleme**    | 8 adımdan sonra tüketilmiş araç çıktılarını işaretle sıkıştırır               | Ek ~%22                                 |
| **Prompt önbelleği**         | Sabit ön eki `cache_control` ile işaretler                                    | Faturalanan token'da ~%30               |

Ölçüm: 25 adımlık örnek bir mimari/refactoring görevinde ölçülen referans değer: 1.14M token → ~210K token (~%82 azalma). Gerçek tasarruf oranı görevin niteliğine, dosya boyutlarına ve model sağlayıcısına göre değişebilir.

> **Döngü ve bütçe güvenliği:** Görevler somut, ayarlardan yapılandırılabilir sınırlarla korunur:
>
> - Tek bir turda en fazla `ahiCode.maxStepsPerTask` (varsayılan: 25 adım) araç çağrısı çalıştırılabilir.
> - Görev başına toplam token bütçesi `ahiCode.maxTokensPerTask` ile sınırlanabilir (varsayılan: 0 = sınırsız). Kontrol bir sonraki model çağrısından **önce** yapılır; duraklatılan turda yarım işlenmiş araç çağrısı kalmaz. Bütçe yalnızca sağlayıcı kullanım (usage) bilgisi döndürüyorsa uygulanır; sürdürmek için sınırı yükseltin.
> - Otonom modda (`autonomy: auto`) kontrolsüz döngüleri önlemek için en fazla `ahiCode.maxContinuations` (varsayılan: 12) otomatik devam turu sınırı vardır.
> - Bulut sağlayıcı (OpenRouter vb.) kullanırken maliyeti kontrol altında tutmak için `maxTokensPerTask` ve `maxStepsPerTask` değerlerini küçültebilir veya otonomi seviyesini `guided` tutarak onayları kontrol edebilirsiniz.
> - Arayüzde kullanılan token miktarı şeffafça gösterilir.

> Araç şemalarını budamak yalnızca ~%4 kazandırır: asıl yük çıktılarda ve geçmişte.
> Kendi MCP sunucusu **token azaltmaz** (her araç şeması prompt'a eklenir, ~110 token/araç)
> ve IPC gecikmesi ekler; MCP yalnızca dış sistem entegrasyonu için kullanılmalıdır.

---

## Model sağlayıcıları

Varsayılan sağlayıcı **Ollama**'dır; hiçbir sağlayıcı seçilmeden yerel çalışır ve API anahtarı istemez.

### EVREN LLM

- İsteğe bağlı sağlayıcı (varsayılan değil).
- Uç nokta: `https://evren-llmapi.ssyz.org.tr/v1` (Platform: `https://evren.ssyz.org.tr/`)
- API anahtarı `X-API-Key` ve `Authorization` başlıklarıyla gönderilir.
- `auto` modeli sunucunun en uygun modeli seçmesini sağlar.
- Kullanım şartları oturum başına bir kez kontrol edilir (`ahiCode.autoAcceptTerms`).

### OpenRouter

- Uç nokta: `https://openrouter.ai/api/v1`
- `HTTP-Referer` ve `X-Title` başlıkları otomatik eklenir.
- Model listesi OpenRouter API'sinden dinamik alınır.

### Ollama (yerel, varsayılan)

- **Varsayılan sağlayıcı.** İnternet ve API anahtarı gerektirmez.
- Varsayılan URL: `http://localhost:11434`. Adres `/v1` ile de girilebilir; iki kez eklenmez.
- Varsayılan model: `llama3.1`. Yerel ve kendi barındırdığınız uç noktalarda `auto` kullanılmaz;
  somut model kimliği zorunludur ve eksikse açıklayıcı bir hata gösterilir.
- Modeller `/api/tags` üzerinden listelenir.
- OpenAI uyumlu `/v1` uç noktası üzerinden çağrılır.
- `cache_control` gönderilmez: yerel sunucular içerik bloğu biçimini reddedebilir. Prompt önbelleği
  yalnızca OpenRouter ve Anthropic tarzı uçlarda kullanılır.

### OpenAI API uyumlu uç noktalar

- LM Studio, vLLM ve OpenAI Chat Completions biçimini uygulayan sunucularla kullanılabilir.
- Temel adres `/v1` ile bitmelidir; modeller `/models`, yanıtlar `/chat/completions` üzerinden alınır.
- VS Code ayarlarında API anahtarı isteğe bağlıdır ve varsa `SecretStorage` içinde saklanır.
- Bu seçenek her sağlayıcının tüm özel özelliklerini desteklediği anlamına gelmez; uyumluluk sunucunun
  araç çağrısı biçimini desteklemesine bağlıdır.

> API anahtarları hiçbir zaman düz metin dosyasına veya ayar dosyasına yazılmaz. VS Code `SecretStorage` kullanılır.

---

## Ayarlar

### VS Code ayarları

| Ayar                            | Varsayılan         | Açıklama                                                                                |
| ------------------------------- | ------------------ | --------------------------------------------------------------------------------------- |
| `ahiCode.selectedProvider`      | `ollama`           | `ollama`, `evren`, `openrouter` veya `openai-compatible`.                               |
| `ahiCode.selectedModel`         | `llama3.1`         | Kullanılacak model kimliği.                                                             |
| `ahiCode.maxStepsPerTask`       | `25`               | Bölüm başına ajan adımı; sınıra ulaşınca görev otomatik olarak yeni bölümle devam eder. |
| `ahiCode.maxTokensPerTask`      | `0`                | Görev başına toplam token bütçesi (0 = sınırsız). Sınıra ulaşınca görev duraklatılır.   |
| `ahiCode.maxContinuations`      | `12`               | Otonom modda en fazla otomatik devam turu sayısı.                                       |
| `ahiCode.useIntegratedTerminal` | `true`             | Ajan komutlarını VS Code tümleşik terminalinde çalıştırır; çıktı ajana iletilir.        |
| `ahiCode.showDiffBeforeWrite`   | `true`             | Ajan dosya yazmadan/düzenlemeden önce değişikliği editörde diff olarak açar.            |
| `ahiCode.promptCaching`         | `true`             | Sistem prompt'u ve araç şemalarını sağlayıcı önbelleğine alır.                          |
| `ahiCode.autoVerify`            | `true`             | Kod değişikliğinden sonra test/lint/tip doğrulaması çalıştırır.                         |
| `ahiCode.autonomy`              | `manual`           | `manual` / `guided` / `auto`; yalnızca akış duraklamalarını kaldırır.                   |
| `ahiCode.captureBaseline`       | `false`            | Görev başındaki test durumunu kaydeder; yalnızca yeni hatalar onarılır.                 |
| `ahiCode.maxRepairAttempts`     | `2`                | Otomatik doğrulama başarısız olduğunda en fazla onarım denemesi.                        |
| `ahiCode.modelRoutingEnabled`   | `false`            | Göreve göre hızlı/derin/inceleme modelini otomatik seçer.                               |
| `ahiCode.fastModel`             | boş                | Basit görevler için model kimliği (yönlendirme açıkken).                                |
| `ahiCode.deepModel`             | boş                | Karmaşık görevler için akıl yürütme modeli kimliği.                                     |
| `ahiCode.reviewModel`           | boş                | Kod inceleme görevleri için bağımsız model kimliği.                                     |
| `ahiCode.autoAcceptTerms`       | `false`            | EVREN kullanım koşullarını kullanıcı adına otomatik kabul eder.                         |
| `ahiCode.sandboxMode`           | `none`             | `none` (ana makine) veya `docker` (yalıtılmış komut).                                   |
| `ahiCode.sandboxImage`          | `node:20-bookworm` | Docker yalıtımında kullanılacak imaj.                                                   |
| `ahiCode.sandboxNetwork`        | `false`            | Docker kapsayıcısına ağ erişimi verir.                                                  |
| `ahiCode.knowledgeEmbeddings`   | `false`            | Bilgi tabanı aramasında yerel anlamsal eşleştirme (Ollama) kullanır.                    |
| `ahiCode.embeddingModel`        | `nomic-embed-text` | Anlamsal arama için Ollama embedding modeli.                                            |
| `ahiCode.callGraphEnabled`      | `true`             | Fonksiyon çağrı haritasını üretir. Kapalıyken araçlar "kapalı" cevabı verir.            |

Bu değerler arayüzdeki Ayarlar ekranıyla senkronize edilir.

> **Bütçe ve adım kontrolü:** Harcama kontrolü adım sınırı (`maxStepsPerTask`) ve otonomi devam limiti (`MAX_AUTO_CONTINUATIONS`) ile sağlanır. Arayüzde kullanılan token miktarı gösterilir. Tasarruf için [Token ekonomisi](#token-ekonomisi) bölümüne bakın.

### Otomatik izinler

| Ayar                                | Varsayılan | Etki                                     |
| ----------------------------------- | ---------- | ---------------------------------------- |
| Dosya okuma/arama                   | Açık       | Okuma araçları onay istemez.             |
| Dosya yazma/düzenleme               | Kapalı     | Diff gösterilir ve onay beklenir.        |
| Terminal komutları, testler ve lint | Kapalı     | Komut çalıştırılmadan önce onay istenir. |

Bu seçenekler AhiCode Ayarları ekranından değiştirilebilir ve **Kaydet** ile uygulanır. Projedeki `.ahi/permissions.json` dosyası bu varsayılanları **yalnızca daraltabilir**: kullanıcının kapalı tuttuğu otomatik onayı açamaz (ayrıntı: [İzinler ve denetim](#izinler-ve-denetim)). Zincirli komutlar ve riskli komut örüntüleri otomatik onay ayarından bağımsız olarak ayrıca onaylanır veya engellenir.

---

## Projeye özel yapılandırma

### AGENTS.md

Kök dizinde `AGENTS.md`, `agent.md` veya `.agents.md` varsa içeriği her göreve sistem prompt'u olarak eklenir.
Büyük dosyalar bağlam bütçesi için otomatik kısaltılır.

### Beceriler (`.agents/skills/`)

Beceriler ayrı klasörlerde değil, doğrudan `.agents/skills/` altında `.md` dosyaları olarak tutulur:

```text
.agents/skills/code-quality.md
.agents/skills/api-tasarimi.md
```

Beceri Markdown frontmatter örneği:

```markdown
---
name: code-quality
description: Temiz kod ve refactoring standartları
---

# Kod Kalitesi

1. Açıklayıcı isimlendirme kullan.
2. Tek sorumluluk ilkesine uy.
```

Ajan `read_skill` aracıyla tam talimatı okur.

### Proje hafızası (`.ahi/memory.md`)

AhiCode, tamamlanan her görevi otomatik olarak `.ahi/memory.md` dosyasına kaydeder:

```markdown
## 2026-10-21T01:23:45.678Z · Kodlama · completed

<!-- task:session_123:msg_456 -->

- **Görev:** Login hatasını düzelt
- **Değişen dosyalar:** `src/auth.ts`
- **Sonuç:** Hata yönetimi güncellendi ve testler geçti.
```

- Dosya insan tarafından okunabilir ve elle düzenlenebilir.
- Ajan her yeni görevde son kayıtları sistem prompt'una alır; aynı işi tekrar yapmaz ve önceki kararlarla çelişmez.
- En fazla 80 kayıt / 64 KB tutulur; eski kayıtlar otomatik budanır.
- Ajanlar ekranındaki **Proje Hafızası** kartından açılabilir veya temizlenebilir.
- Varsayılan olarak `.gitignore` içindedir; proje ekibiyle paylaşmak isterseniz kaldırabilirsiniz.

### Özel alt ajanlar (`.agents/agents/`)

Özel ve özelleştirilmiş alt ajanlar ayrı klasörlerde değil, doğrudan `.agents/agents/` altında `.md` dosyaları olarak tutulur:

```text
.agents/agents/devops-engineer.md
.agents/agents/architect.md
```

```markdown
---
name: devops-engineer
role: devops
description: Docker ve CI/CD uzmanı
tools: read_file, list_directory, search_files, read_skill, write_file, edit_file, execute_command
---

Sen bu projenin DevOps uzmanısın...
```

- `tools` belirtilmezse özel ajan varsayılan olarak **salt-okunur** araçlarla çalışır.
- Özel ajanlar da `.ahi/permissions.json` deny kurallarına tabidir.
- Tüm alt ajan araç çağrıları audit günlüğüne yazılır.

Yerleşik ajanlar:

| Ajan        | Görev                             |
| ----------- | --------------------------------- |
| `architect` | Mimari analiz ve uygulama planı   |
| `coder`     | Kod üretimi ve refactoring        |
| `tester`    | Test çalıştırma ve hata çözme     |
| `reviewer`  | Kod kalitesi ve güvenlik denetimi |

---

## MCP sunucuları

Desteklenen yapılandırma dosyaları (öncelik sırasıyla):

1. `.ahi/mcp_config.json`
2. `mcp_config.json`
3. `.mcp.json`

### stdio sunucu örneği

```json
{
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sqlite", "./data.db"]
    }
  }
}
```

### HTTP / SSE sunucu örneği

```json
{
  "mcpServers": {
    "uzak-sunucu": {
      "type": "http",
      "url": "https://example.com/mcp"
    }
  }
}
```

Özellikler:

- Sunucular paralel başlatılır ve oturum boyunca önbelleklenir.
- stdio sunucuları workspace kökünde (`cwd`) çalışır.
- **Ortam değişkenleri:** stdio sunucularına miras kalan ortam sırları (API anahtarı, token, şifre görünümlü değişkenler) geçirilmez; yalnızca `PATH`, `HOME`, `NODE_*` gibi güvenli değerler korunur. Bir sunucuya anahtar gerekiyorsa yapılandırmadaki `env` alanıyla açıkça verin: `"env": { "API_KEY": "..." }`.
- `Mcp-Session-Id` ve SSE yanıtları desteklenir.
- `tools/list` sayfalaması (`nextCursor`) işlenir.
- Bağlantı koparsa üstel geri çekilmeyle yeniden bağlanılır.
- Workspace güvenilir değilse MCP sunucuları başlatılmaz.

> MCP sunucuları repo tarafından tanımlanan komutları çalıştırabilir. Yalnızca güvendiğiniz workspace'lerde kullanın.

---

<a id="izinler-ve-denetim"></a>

## İzinler ve denetim

### `.ahi/permissions.json`

```json
{
  "allow": {
    "readFiles": ["**/*"],
    "writeFiles": ["src/**/*", "tests/**/*"],
    "commands": ["npm test*", "npm run build*", "git status*", "git diff*"]
  },
  "deny": {
    "readFiles": ["secret/**/*"],
    "writeFiles": [".env*", "**/*.pem", "**/*.key", "package-lock.json"],
    "commands": ["git push*", "rm -rf /*", "mkfs*"]
  },
  "autoApprove": {
    "readFiles": true,
    "writeFiles": false,
    "executeCommands": false
  }
}
```

Öncelik: **deny > global auto-approve anahtarı (proje dosyası yalnızca kapatabilir) > allow filtresi**.

- Yollar workspace'e göre normalize edilir; `./secret/x` ve mutlak workspace yolları aynı kurala yakalanır.
- `autoApprove` global ayarı **ana anahtardır**: kapalıysa proje dosyasındaki `allow` listeleri onay
  istemeyi kaldıramaz. Açıksa `allow` listeleri hangi yolların/komutların otomatik onaylanacağını
  **daraltır**; listede olmayan hedef yeniden onay ister.
- `allow.commands` yalnızca zincirlenmemiş ve risk politikasında `safe` sayılan komutlarda etkilidir.
- `.env`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`, `.git/**`, `.ahi/hooks.json`,
  `.ahi/mcp_config.json`, `.ahi/permissions.json`, `AGENTS.md` ve `.agents/**` varsayılan olarak
  yazmaya kapalıdır.
- Bozuk izin dosyası yazma/komut işlemlerini otomatik onaya kapatır.

> [!WARNING]
> **Proje izin dosyası global `autoApprove` bayraklarını genişletemez.** Deponun içinden gelen
> `.ahi/permissions.json` dosyası, kullanıcı terminal komutlarını elle onaylıyorsa
> `executeCommands: true` yazarak bu onayı atlayamaz. Ayrıca:
>
> - `*`, `**` ve `**/*` gibi joker desenler yazma/komut otomatik onayında **yok sayılır**.
> - Güvenilmeyen (untrusted) workspace'te proje dosyasındaki `allow` ve `autoApprove` yok sayılır;
>   yalnızca sizin global ayarlarınız ile `deny` / hassas dosya koruması geçerli olur.
> - Güvenilir workspace'te `allow` listeleri yalnızca **filtredir**: global anahtar açıkken listelenen
>   yolları otomatik bırakır, liste dışını yine onaya gönderir. Anahtar kapalıyken hiçbir şeyi
>   otomatikleştirmez.
> - `.ahi/hooks.json` içindeki komutlar, MCP yapılandırması gibi parmak izi (fingerprint) tabanlı
>   kullanıcı onayı ister; dosya her değiştiğinde yeniden sorulur.
> - Güven sınırı **dosya ve komut araçları** içindir. `web_fetch`, MCP çıktıları ve depo dosyaları
>   modele "güvenilmez veri" olarak girer; bu içeriklerdeki talimatlar kullanıcı talimatı sayılmamalıdır.
>   Model bu içerikten etkilenip yazma/komut önerirse yine onay akışı devreye girer.

### Denetim günlüğü

`.ahi/audit.log` dosyasına her araç kararı JSONL olarak, hash zinciriyle yazılır:

```json
{
  "timestamp": "2026-10-24T12:34:56.789Z",
  "decision": "completed",
  "tool": "edit_file",
  "args": "{\"path\":\"src/app.ts\"}",
  "prevHash": "…",
  "hash": "…"
}
```

- API anahtarları, dosya içerikleri ve replacement metinleri redakte edilir.
- Ana ajan ve alt ajan araç çağrıları kaydedilir.
- Her kayıt bir öncekinin `hash` değerini `prevHash` olarak taşır. Bir kaydı değiştirmek veya
  aradan silmek zinciri kırar.

Zinciri doğrulamak için:

```bash
npm run audit:verify -- --workspace .
```

- Değiştirilmiş kayıt varsa `Hash mismatch`, silinmiş/sıralanmış kayıt varsa `Chain break` hatası verir
  ve bozuk satırın numarasını yazar. `--workspace` verilmezse geçerli dizin kullanılır.
- Eski (hash'siz, sekmeyle ayrılmış) kayıtlar atlanır ve kaç tanesinin atlandığı bildirilir.
- Bu zincir bir imza değildir: makineyi tamamen ele geçiren biri zinciri baştan hesaplayabilir.
  Koruması, günlüğün kopyalanması veya önceden kaydedilmiş bir `head hash` ile karşılaştırılması
  durumunda belirginleşir.

---

## Hook'lar

`.ahi/hooks.json`:

```json
{
  "hooks": [
    {
      "lifecycle": "PreToolUse",
      "toolMatcher": "write_file|edit_file",
      "command": "npm run lint"
    },
    {
      "lifecycle": "Stop",
      "command": "echo 'Görev tamamlandı'"
    }
  ]
}
```

Desteklenen yaşam döngüleri: `PreToolUse`, `PostToolUse`, `Stop`.

- Hook komutları workspace güvenilir değilse çalıştırılmaz.
- Komutlar workspace kökünde ve 15 saniye zaman aşımıyla çalışır.
- Hatalı `toolMatcher` desenleri ajan döngüsünü kilitlemez.

---

## Güvenlik modeli

| Katman                  | Koruma                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Path jail**           | Workspace dışına dosya erişimi engellenir; symlink kaçışı kontrol edilir.                                                                    |
| **Hassas dosyalar**     | `.env`, anahtarlar, sertifikalar ve `.git` içeriği varsayılan korumalı.                                                                      |
| **Komut güvenliği**     | Merkezî risk politikası: engellenen, riskli ve güvenli komutlar; riskli komutlar otomatik onaydan bağımsız olarak her zaman açık onay ister. |
| **Gerçek iptal**        | Model istekleri `AbortController`; terminal komutları SIGTERM/SIGKILL.                                                                       |
| **Plan modu kilidi**    | Yazma/komut araçları hem modele sunulmaz hem yürütmede reddedilir.                                                                           |
| **Subagent izolasyonu** | Rol bazlı araç allowlist'i, salt-okunur varsayılan ve deny kuralları.                                                                        |
| **SecretStorage**       | API anahtarları şifreli saklanır, UI'ya maskeli gönderilir.                                                                                  |
| **CSP**                 | Webview yalnızca eklenti kaynaklarına izin verir.                                                                                            |
| **Workspace Trust**     | Güvenilmeyen workspace'te MCP ve hook komutları çalışmaz.                                                                                    |
| **Audit**               | Kritik araç kararları redakte edilerek günlüğe yazılır.                                                                                      |
| **Proje izin sınırı**   | `.ahi/permissions.json` yalnızca kısıtlar; global otomatik onayı genişletemez, joker desenler yok sayılır.                                   |
| **Güven sınırı**        | Web/MCP/depo içeriği güvenilmez veridir; yazma ve komut yine onay ister.                                                                     |

Yine de otonom bir ajanın dosya ve komut çalıştırma yetkisi olduğunu unutmayın. Kritik depolarda önce yedek alın,
`autoApprove` seçeneklerini kapalı tutun ve izin dosyasını kullanın.

### Komut risk politikası

Komutlar tek bir merkezî politikayla (`src/shared/commandPolicy.ts`) üç sınıfa ayrılır:

| Sınıf          | Örnekler                                                                                                                                       | Davranış                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------- |
| **Engellenen** | `rm -rf /`, `sudo`, `mkfs`, `dd of=/dev/...`, `git push --force`, `git clean` (dry-run hariç), `curl ... \                                     | sh`, `DROP TABLE`, fork bomb     | Hiçbir onayla çalıştırılmaz.                                                                 |
| **Riskli**     | `rm`, `git reset --hard`, `git checkout --`, `sed -i`, `find -delete`, `npm install`, `node -e`, yönlendirme (`>`), zincirleme (`&&`, `;`, `\  | `)                               | Otomatik onay açık olsa ve proje allowlist'inde yer alsa bile **her zaman açık onay** ister. |
| **Güvenli**    | `npm test`, `npm run lint`, `npm run build`, `git status`, `git diff`, `rg METİN src`                                                          | Normal izin kurallarına tabidir. |

> **Komut adı tek başına yeterli değil:** Güvenli listedeki komutların argümanları da denetlenir.
> `rg --pre <betik>` (harici işlemci çalıştırır), `git diff --output=<dosya>`, `git reflog expire`,
> `../` veya mutlak ev yolu içeren argümanlar (`cat /etc/hosts`, `touch ../dışarı.txt`) ve depodaki
> `package.json` betiklerini keyfi kod olarak çalıştıran `npm start`, `npm run dev`, `npm run watch`,
> `npx <paket>` otomatik onaylanamaz; hepsi açık onay ister.

> **Allowlist mantığı ve sezgisel yaklaşım:** Politika allowlist tabanlı bir regex sezgiselidir:
> Yalnızca bilinen güvenli kalıplar otomatikleşebilir; listede yer almayan yeni araçlar, bilinmeyen komutlar
> veya kabuk metakarakteri içeren her çağrı varsayılan olarak **riskli** sınıfına düşer ve kullanıcı onayı ister.
> Bu katman karmaşık kabuk syntax hilelerine karşı tam bir kabuk ayrıştırıcısı (AST/tokenizer) değildir;
> güvenilmeyen projelerde tam yalıtım için Docker sandbox kullanılmalıdır.

> [!TIP]
> **Dev Containers Alternatifi:** Eklenti içi Docker sandbox kullanmak istemiyorsanız, projeyi VS Code'un resmi **Dev Containers** uzantısıyla doğrudan bir konteyner içinde açabilirsiniz. Böylece ajanın çalıştırdığı tüm komutlar ve araçlar ana makinenizden tamamen yalıtılmış olur.

> [!IMPORTANT]
> **Geri alma (undo) kapsamı**
>
> | Ne değişti                      | Geri alma yöntemi                                       |
> | ------------------------------- | ------------------------------------------------------- |
> | `write_file` / `edit_file`      | Dosya snapshot'ı ve tur checkpoint'i (her zaman)        |
> | `execute_command` / `run_tests` | **Git kontrol noktası**: komut öncesi `HEAD` kaydedilir |
>
> Komut geri alma yalnızca çalışma ağacı **temiz** ve klasör bir Git deposu olduğunda kaydedilir.
> Kirli ağaçta bilinçli olarak devre dışıdır: kullanıcının commit edilmemiş işini silmek, geri alma
> sağlamaktan daha kötüdür. Bu durumda araç kartında geri alma düğmesi çıkmaz.
>
> Geri alma yalnızca **komutun ürettiği** etkileri geri alır: komut bittikten sonra oluşturduğunuz
> dosyalar ve yaptığınız düzenlemeler kullanıcının işi sayılır, korunur ve sonuç mesajında listelenir.
>
> Kapsam dışı: Git deposu olmayan klasörlerde çalıştırılan komutlar, Docker sandbox dışına yazan
> işlemler ve ağ üzerinden yapılan değişiklikler (ör. uzak veritabanı migrasyonu).

---

## Mimari ve Geliştirici Kılavuzu

AhiCode'un iç modül hiyerarşisi, ReAct veri akışı, teknoloji yığını, UI tasarım sistemi ve 550+ testlik kalite kapıları hakkında kapsamlı teknik bilgi için [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) belgesini inceleyebilirsiniz.

---

## VS Code entegrasyonu

- **Komut Paleti (`Ctrl+Shift+P` / `Cmd+Shift+P`):**
  - `AhiCode: Sohbeti Aç` (`ahi-code.openSidebar`): İkincil kenar çubuğundaki AhiCode asistanını açar ve odaklar.
  - `AhiCode: Yeni Görev Başlat` (`ahi-code.newTask`): Arayüzü açar ve temiz bir görev oturumu başlatır.
- **Terminal:** ajan komutları `AhiCode` adlı tümleşik terminalde görünür şekilde çalışır
  (`ahiCode.useIntegratedTerminal`, varsayılan açık). Çıktı ve çıkış kodu shell integration ile
  yakalanır ve modele iletilir; shell integration yoksa komut yine terminalde başlar ve durum
  bildirilir. Docker sandbox etkinken izolasyon önceliklidir.
- **Diff inceleme:** "Değiştirilen dosyalar" ekranındaki **Fark** düğmesi, dosyanın en eski
  anlık görüntüsü ile güncel içeriğini VS Code diff görünümünde açar (git benzeri before/after).
  Araç adım kartlarındaki diff de aynı görünümü kullanır.

---

## Sorun giderme

### “API anahtarı girilmedi” hatası

Ayarlar ekranında doğru sağlayıcıyı seçtiğinizden ve anahtarın kaydedildiğinden emin olun. Anahtar maskeli
görünüyorsa kayıtlıdır; tekrar yazmanız gerekmez.

### Model listesi gelmiyor

- OpenRouter için internet bağlantısını kontrol edin.
- Ollama için `ollama serve` çalıştığından emin olun.
- `.ahi` veya ağ proxy ayarlarınızı kontrol edin.

### Onay kartı görünmüyor

- İşlem `autoApprove` ile otomatik onaylanmış olabilir.
- `waiting_approval` durumunda araç kartı otomatik açılır.
- Onay mesajlarının bağlı olduğundan emin olmak için arayüzü yenileyin.

### MCP sunucusu bağlanmıyor

- Workspace'in güvenilir olduğundan emin olun (**Workspace Trust**).
- `command`, `args` ve göreli yolların workspace köküne göre olduğunu kontrol edin.
- Sunucunun stderr çıktısını VS Code Developer Tools konsolunda inceleyin.
- Değişiklikten sonra MCP ekranındaki yenile düğmesine basın.

### Ajan plan modunda dosya değiştirmiyor

Bu beklenen davranıştır. Planlama modu salt-okunur çalışır. Kodlama moduna geçin.

### Komut iptal edilmiyor

Güncel sürümde terminal komutları iptal sinyaliyle sonlandırılır. Uzun süren alt süreçler için **Durdur**
düğmesini kullanın; MCP araç çağrıları kendi zaman aşımına sahiptir.

## Destek ve geri bildirim

- Hata bildirmek veya özellik istemek için [GitHub Issues](https://github.com/ysf-bkr/ahi-code/issues) sayfasını kullanın.
- Bildirime VS Code ve AhiCode sürümünü, işletim sistemini, seçili sağlayıcıyı ve hatayı yeniden üretme adımlarını ekleyin.
- API anahtarlarını, erişim belirteçlerini, özel kaynak kodunu veya kişisel verileri issue içeriğine ve ekran görüntülerine eklemeyin.
- Marketplace yayını tamamlandığında kurulum ve sürüm bilgileri bu README'de güncellenecektir.

---

## Bilinen sınırlar

### Güvenlik sertleştirme

- Docker sandbox varsayılan olarak kapalı. "Strict" mod eklenmedi: riskli komutlar yalnızca
  sandbox içinde çalışsın seçeneği planlanıyor.
- Denetim günlüğü hash zinciriyle kurcalamaya karşı **kanıt** üretir, ama makineyi ele geçiren
  biri zinciri baştan hesaplayabilir. Baş hash'in workspace dışında saklanması planlanıyor.
- Komut risk desenleri sezgiseldir; sert sınır yalnızca sandbox'tır.

### Editör deneyimi

- Satır içi düzenleme (Cmd/Ctrl+K), seçim komutları (açıkla/düzelt/test) ve Problems paneli
  entegrasyonu yok.
- Görsel girdi (ekran görüntüsü, PDF) yok.
- Kod Görünümü ekranı yok; diff, "neden" açıklaması ve kabul kriteri eşlemesi sohbet
  kartlarında gösteriliyor.

### Bağlam ve oturumlar

- Bağlam için model tabanlı **konuşma** özetlemesi yok (kırpma/compaction kullanılır); ancak
  bilgi tabanındaki dosya özetleri modelle üretilir (tur başına en fazla 3).
- Kabul kriterleri doğrulama sonuçlarından otomatik işaretlenmiyor.
- Oturum yeniden adlandırma ve dallandırma yok; oturumlar `workspaceState` içinde tutuluyor.
- Anlamsal arama isteğe bağlıdır ve Ollama'da bir embedding modeli gerektirir
  (`ahiCode.knowledgeEmbeddings`); kapalıyken alt dize aramasına düşer.

### Çağrı haritası

- Çağrılar referans tabanlı çıkarılır; dinamik çağrılar, geri çağrılar, bağımlılık enjeksiyonu,
  ada göre çağırma ve yansıma haritada görünmez.
- Çağrı hiyerarşisini desteklemeyen dil sunucularında o dil için harita üretilmez
  (`skipped` olarak raporlanır).
- Yalıtılmış worktree'de çalışan alt ajan ana haritayı salt-okunur görür; worktree'deki
  değişiklikler o haritaya yansımaz.
- Etki alanı 50 düğümü geçerse sonuç özetlenir.

### Platform ve dağıtım

- Paralel alt ajan çalıştırma vardır (en fazla 4); buna karşılık tek bir turdaki araç
  çağrıları sırayla yürütülür.
- MCP `resources/*` ve `prompts/*` desteği yok; sunucu başına araç allowlist'i yok.
- Uzun ömürlü SSE transportu yok.
- Komutların dosya etkileri, temiz Git ağacında alınan kontrol noktasından geri alınabilir;
  depo dışı veya kirli ağaçta bu garanti yoktur.
- Alt ajanlar onay gerektiren işlemi kendileri yapamaz; ana ajanın onay akışına devretmek
  zorundadır.
- Çoklu kök workspace için tam kök seçici arayüzü yok.
- Yerel Anthropic/Gemini/Azure adaptörleri yok (OpenRouter ve OpenAI uyumlu uç nokta kısmen kapsar).
- Arayüz yalnızca Türkçe; İngilizce yerelleştirme yok.
- Windows'a özel komut yürütme testleri yok.
- Yayımlanmış Marketplace listesi ve ekran görüntüleri/GIF yok.
- Genel amaçlı plugin SDK'sı, yerel HTTP sunucusu veya istemci SDK'sı yok.

Bilinen davranışlar:

- Snapshot ve checkpoint'ler `.ahi/snapshots/` ve `.ahi/checkpoints/` altında kalıcıdır.
- Proje hafızası `.ahi/memory.md` ve `.ahi/memory.jsonl` dosyalarında kalıcıdır.
- Oturum geçmişi `workspaceState` içinde saklanır; `globalState` kullanılmaz.
- Oturumlar JSON arşivi olarak dışa aktarılıp yeniden içe aktarılabilir. Markdown çıktısı yalnızca
  okuma/paylaşma amaçlıdır. İçe aktarılan oturum her zaman `idle` başlar, bekleyen araç çağrıları
  iptal edilmiş sayılır ve mevcut bir oturumun üzerine yazılmaz.
- `@dosya` bahsetme, aktif dosya ve seçili kod bağlamı sistem prompt'una eklenir.
- Çoklu kökte her kökün snapshot/checkpoint yöneticisi ayrı tutulur.
- Headless kullanım için `npm run cli` ve `dist/cli.js` mevcuttur.
- Ağ istekleri varsayılan 20 saniye zaman aşımına sahiptir (model istekleri 120 saniye).

---

## Katkı

1. Depoyu fork'layın.
2. Yeni bir dal açın: `git checkout -b ozellik/yeni-ozellik`
3. Değişikliklerinizi yapın.
4. `npm run typecheck && npm run lint && npm test && npm run build` çalıştırın.
5. Anlamlı bir commit mesajıyla PR açın.

Ayrıntılı geliştirme kuralları için
[CONTRIBUTING.tr.md](https://github.com/ysf-bkr/ahi-code/blob/main/CONTRIBUTING.tr.md)
(İngilizce: [CONTRIBUTING.md](https://github.com/ysf-bkr/ahi-code/blob/main/CONTRIBUTING.md)),
güvenlik açığı bildirimi için
[SECURITY.tr.md](https://github.com/ysf-bkr/ahi-code/blob/main/SECURITY.tr.md)
(İngilizce: [SECURITY.md](https://github.com/ysf-bkr/ahi-code/blob/main/SECURITY.md))
dosyalarına bakın.
Güvenlik açıklarını **genel issue olarak açmayın**.

İletişim: **Yusuf BEKAR** — [ybekar@msn.com](mailto:ybekar@msn.com)

Katkı sağlarken:

- TypeScript strict moduna uyun.
- Yeni araçlar için path safety ve izin kontrollerini unutmayın.
- Kullanıcıya görünen metinleri Türkçe tutun.
- Güvenlik davranışını değiştiren PR'larda test ekleyin.

---

## Lisans

[MIT](./LICENSE) © 2026 Yusuf BEKAR · [ybekar@msn.com](mailto:ybekar@msn.com)

<div align="center">

**AhiCode** — Yusuf BEKAR tarafından geliştirilen bağımsız, açık kaynak yazılım geliştirme ajanı.

</div>
