<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./resources/logo-dark.png" />
  <img src="./resources/logo.png" width="420" alt="AhiCode — Yazılım Geliştirme" />
</picture>

# AhiCode

**VS Code içinde çalışan, Ahilik zanaat disipliniyle güçlendirilmiş otonom yazılım geliştirme ajanı.**

**Türkçe** | [🇬🇧 English](README.md)

> _"Eline, beline, diline sahip ol."_ — Ahilik Zanaat Ahlakı  
> **El (Zanaat):** Titiz kod yazımı ve mimari analiz · **Bel (Şed Kuşağı):** Kırılmaz izin kalkanı ve dizin hapsi · **Dil (Ahlak):** Dürüst durum bildirimi ve hash zincirli denetim.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.106-007ACC?logo=visualstudiocode)](https://code.visualstudio.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![CI](https://github.com/ysf-bkr/ahi-code/actions/workflows/ci.yml/badge.svg)](https://github.com/ysf-bkr/ahi-code/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-638%20passing-2ea44f)](./docs/DEVELOPMENT.tr.md)

**Geliştirici:** Yusuf BEKAR · **E-posta:** [ybekar@msn.com](mailto:ybekar@msn.com)

[GitHub Deposu](https://github.com/ysf-bkr/ahi-code) · [Hata Bildir / Özellik İste](https://github.com/ysf-bkr/ahi-code/issues) · [Geliştirici Kılavuzu](./docs/DEVELOPMENT.tr.md)

</div>

> [!IMPORTANT]
> **Varsayılan Olarak Yerel ve Güvenli Çalışır**
>
> AhiCode hiçbir bulut sağlayıcısına bağımlı değildir. **Varsayılan sağlayıcı Ollama'dır**: kurulum sonrasında herhangi bir API anahtarı gerekmeden, tamamen kendi makinenizde çevrimdışı çalışabilir. EVREN LLM, OpenRouter ve OpenAI uyumlu uç noktalar isteğe bağlı olarak yapılandırılabilir.

---

## Öne Çıkan Özellikler

| Özellik | Açıklama |
| --- | --- |
| **Otonom ReAct Döngüsü** | Hedefe ulaşana kadar dosyaları inceler, terminal komutları çalıştırır, testleri koşturur ve hataları otonom olarak düzeltir. |
| **Kod Değişiklikleri ve İnceleme (Review)** | Yapılan tüm kod düzenlemeleri tur sonunda toplanır; tek tıkla VS Code Diff görünümünde incelenebilir ve gerektiğinde geri alınabilir. |
| **Yönlendirilmiş Geliştirme Akışı** | Anlama → İstek → Spec Onayı → Modül Haritası ve Plan Onayı → Uygulama → İnceleme → Doğrulama aşamalarıyla kontrollü mühendislik. |
| **Endüstriyel Modül Akışı** | Kod yazmadan önce iş, katmanlı modüllere ayrılır (shared → domain → infrastructure → application → interface); her modüle sahip uzman atanır ve modüller bağımlılık sırasıyla yazılır. Katman ihlalleri ve döngüler reddedilir. |
| **Geniş Model Desteği** | EVREN LLM (SSYZ), Yerel Ollama, LM Studio, OpenRouter ve tüm OpenAI API uyumlu modellerle tam uyum. |
| **Güvenli Sır Saklama** | API anahtarları işletim sisteminin güvenli anahtarlığında (`SecretStorage`) şifreli saklanır, arayüzde asla açık gösterilmez. |
| **Proje Hafızası ve Bilgi Tabanı** | `.ahi/memory.md` ve `.ahi/knowledge/` ile projeninizin mimari kararlarını, kurallarını ve sembollerini hatırlar. |
| **Geri Alma (Undo) ve Kontrol Noktaları** | Her tur başında Git checkpoint'i alınır; istenmeyen değişiklikler tek tıkla eski haline döndürülür. |
| **EVREN Kotası ve Model Çubuğu** | Sohbet altındaki çubuk, EVREN günlük token kotasını (kullanılan / sınır / kalan) canlı gösterir ve sohbetten ayrılmadan model değiştirmeyi sağlar. |
| **İki Dilli Belgeler ve Türkçe Arayüz** | İngilizce/Türkçe iki dilli proje belgeleri; arayüzdeki tüm hata mesajları, bildirimler ve plan adımları eksiksiz Türkçe. |

---

## Hızlı Başlangıç

### 1. Kurulum

> [!NOTE]
> Uzantı henüz VS Code Marketplace'te yayımlanmadı. İlk sürüme kadar VSIX
> paketini aşağıdaki adımlarla yerel olarak üretip kurun.

Yerel VSIX paketiyle (`out/ahi-code-0.0.2.vsix`) derleyip kurabilirsiniz:

```bash
# Otomatik derleme, paketleme ve kurulum için:
npm run install:ext

# veya üretilen VSIX paketini doğrudan kurmak için:
code --install-extension out/ahi-code-0.0.2.vsix --force
```

### 2. Model Sağlayıcınızı Seçin

VS Code ikincil kenar çubuğundaki (secondary sidebar) **AhiCode** simgesine tıklayın veya `Ctrl+Shift+P` (`Cmd+Shift+P`) ile `AhiCode: Sohbeti Aç` komutunu çalıştırın.

- **Yerel Ollama (Önerilen yerel seçenek):** Ollama çalışıyorsa hiçbir ek ayar yapmadan doğrudan sohbete başlayabilirsiniz.
- **EVREN LLM (SSYZ):** Ayarlar ekranından sağlayıcıyı EVREN seçip API anahtarınızı girin.
- **OpenRouter / OpenAI Uyumlu:** İlgili sağlayıcıyı seçip anahtarınızı kaydedin.

### 3. Göreve Başlayın

AhiCode giriş alanına görevinizi yazın:
- _"Projede derleme ve tip hatalarını bulup düzelt."_
- _"Auth servisi için birim testleri yaz ve çalıştır."_
- _"Kod tabanını güvenlik ve performans açısından incele."_

---

## Modlar: Kodlama ve Planlama

AhiCode iki temel çalışma moduna sahiptir:

1. **Kodlama Modu (`code`):** Dosya oluşturma, düzenleme ve terminal komutlarını çalıştırma yetkisine sahiptir. Projenizi aktif olarak geliştirir.
2. **Planlama Modu (`plan`):** Dosya yazma ve komut çalıştırma araçları teknik olarak kilitlidir. Yalnızca okuma, arama ve mimari analiz yaparak kapsamlı yol haritaları hazırlar.

---

## Sohbet ve İnceleme (Review) Deneyimi

AhiCode arayüzü, modern kodlama ajanlarının en iyi pratiklerini bir araya getirir:
- **Kod Değişiklikleri Paneli:** Asistanın bir turda oluşturduğu veya değiştirdiği tüm dosyalar bir kartta toplanır.
- **Tek Tıkla Diff:** Değiştirilen satırları incelemek için **İncele (Diff)** butonuna tıklamanız yeterlidir.
- **Adım Bazlı Geri Alma:** Herhangi bir dosyadaki değişikliği **Geri Al** butonuyla iptal edebilirsiniz.
- **Görev Planı İlerlemesi:** Görev adımları durum çubuğunda canlı olarak takip edilir (`%25`, `%50`, `%100`).

---

## Temel Ayarlar

Aşağıdaki ayarları VS Code Ayarlarından (`settings.json`) veya AhiCode arayüzündeki Ayarlar ekranından yapılandırabilirsiniz:

| Ayar | Varsayılan | Açıklama |
| --- | --- | --- |
| `ahiCode.selectedProvider` | `ollama` | Model sağlayıcısı (`ollama`, `evren`, `openrouter`, `openai-compatible`) |
| `ahiCode.selectedModel` | `llama3.1` | Kullanılacak model adı |
| `ahiCode.autonomy` | `manual` | Otonomi seviyesi (`manual`, `guided`, `auto`) |
| `ahiCode.maxTokensPerTask` | `0` | Görev başına maksimum token bütçesi (`0` = sınırsız) |
| `ahiCode.maxContinuations` | `12` | Otonom modda art arda yapılabilecek en fazla otomatik devam turu |

---

## Mimari ve Geliştirici Kılavuzu

AhiCode'un iç yapısı, modül katmanları, test çalıştırma ve katkı sağlama yönergeleri ayrı belgelere ayrılmıştır:

- **[Geliştirici Kılavuzu (docs/DEVELOPMENT.tr.md)](./docs/DEVELOPMENT.tr.md):** Kaynaktan derleme, test çalıştırma, tasarım sistemi değişkenleri, MCP entegrasyonu ve katkı kuralları.
- **[Mimari Dokümantasyonu (docs/ARCHITECTURE.tr.md)](./docs/ARCHITECTURE.tr.md):** Çekirdek ReAct döngüsü, araç zinciri, denetim katmanı ve LSP detayları.
- **[Gizlilik Bildirimi (docs/PRIVACY.tr.md)](./docs/PRIVACY.tr.md):** Veri güvenliği, yerel model ilkeleri ve telemetri politikası.

---

## Bilinen Sınırlamalar

- **Komut yan etkileri geri alınamaz:** snapshot ve checkpoint'ler yalnızca `write_file` / `edit_file` ile değiştirilen dosyaları kapsar. `execute_command` tarafından oluşturulan veya değiştirilen dosyalar geri alma özelliğiyle kurtarılamaz; bu dosyalar için Git kullanın.
- **Plan modu sandbox değil, araç kilididir:** plan modu yazma ve komut araçlarını şemadan çıkarır, ancak işletim sistemi düzeyinde yalıtım sağlamaz. Güvenilmeyen depolar için Dev Container kullanın.
- **Henüz Marketplace'te değil:** kurulum şimdilik yerel olarak üretilen VSIX paketi gerektirir.

---

## Lisans ve Destek

Bu proje [MIT Lisansı](./LICENSE) kapsamında açık kaynak olarak geliştirilmektedir.

Katkılar memnuniyetle karşılanır: [CONTRIBUTING.tr.md](./CONTRIBUTING.tr.md) ve
[Davranış Kuralları](./CODE_OF_CONDUCT.tr.md) belgelerine bakın. Güvenlik
sorunlarını [SECURITY.tr.md](./SECURITY.tr.md) uyarınca özel kanaldan bildirin.

Sorularınız, hata bildirimleriniz ve özellik önerileriniz için [GitHub Issues](https://github.com/ysf-bkr/ahi-code/issues) sayfasını kullanabilir veya [ybekar@msn.com](mailto:ybekar@msn.com) adresinden iletişime geçebilirsiniz.

