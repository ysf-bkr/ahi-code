# Güvenlik Politikası

> [!NOTE]
> Bu belge Türkçe sürümdür; İngilizce aslı için [SECURITY.md](./SECURITY.md).

AhiCode, makinenizde dosya okuyup yazabilen ve terminal komutları çalıştırabilen
bir VS Code eklentisidir. Aşağıdaki sorun sınıflarına ilişkin bildirimleri
ciddiye alıyoruz:

- Çalışma alanı kökü dışına çıkan yol dolaşımı (path traversal) veya symlink kaçışları
- İzin/onay akışının veya plan modu araç kilidinin atlatılması
- Komut enjeksiyonu, kabuk zincirleme atlatmaları veya sandbox kaçışları
- Sır sızması (API anahtarları, `.env`, özel anahtarlar, denetim günlüğü maskelemesi)
- Onay olmadan yazma veya komut çalıştırmayı tetikleyebilen prompt enjeksiyonu yolları
- `web_fetch` / `web_search` içindeki Sunucu Tarafı İstek Sahteciliği (SSRF)
- `.ahi/permissions.json` veya hook'lar üzerinden ayrıcalık yükseltme

## Güvenlik açığı bildirimi

Güvenlik sorunları için lütfen **herkese açık** bir GitHub issue **açmayın**.

1. GitHub'ın özel güvenlik açığı bildirim yolunu kullanın:
   <https://github.com/ysf-bkr/ahi-code/security/advisories/new>
2. Bu yol kullanılamıyorsa **ybekar@msn.com** adresine konu satırı
   `AhiCode security report` olacak şekilde e-posta gönderin.

Bildiriminize şunları ekleyin:

- Sorunun ve etkisinin açıklaması
- Yeniden üretme adımları (mümkünse minimal bir çalışma alanı veya komut)
- Etkilenen sürüm/commit ve platform
- Varsa önerdiğiniz çözüm

Bildirimleri 72 saat içinde yanıtlamayı ve bir düzeltme ya da hafifletmeyi
en kısa sürede yayınlamayı hedefliyoruz. Herhangi bir kamuya açık açıklamadan
önce düzeltme göndermemiz için makul süre tanıyın.

## Kapsam

Kapsam dahilinde:

- Bu depodaki eklenti (`src/`, `webview-ui/`, `scripts/`)
- Paketlenen CLI (`dist/cli.js`)

Kapsam dışında:

- Yapılandırdığınız üçüncü taraf model sağlayıcılarındaki veya MCP sunucularındaki açıklar
- Zaten ele geçirilmiş bir makine veya kötü niyetli bir VS Code kurulumu gerektiren sorunlar
- README'nin bilinen sınırlar olarak açıkça belgelediği riskler
  (örneğin `execute_command` değişiklikleri snapshot kapsamında değildir)

## Güvenlik modeli özeti

- Çalışma alanı yol hapsi, symlink kontrolleriyle birlikte.
- Deny kuralları ve hassas dosya koruması, güvenilmeyen çalışma alanlarında dahi
  her zaman geçerlidir.
- Bir deponun `.ahi/permissions.json` dosyası global `autoApprove` anahtarlarını
  genişletemez. Proje `allow` listeleri yalnızca kullanıcı ilgili anahtarı zaten
  açmışsa uygulanan filtrelerdir; elle onayı asla geri kapatmazlar.
- `.ahi/hooks.json` içindeki depo hook'ları, proje MCP sunucularıyla aynı sözleşmeyi
  izler: açık, parmak izi kapsamlı kullanıcı onayı isterler ve güvenilmeyen çalışma
  alanında asla yüklenmezler.
- Güvenilmeyen çalışma alanında proje izinleri hiç uygulanmaz.
- Yazma ve komut işlemleri, kullanıcı açıkça izin vermedikçe onay ister.
- Plan modu, yazma/komut araçlarını listeden çıkarır ve reddeder.
- API anahtarları VS Code `SecretStorage` içinde saklanır.
- Dev Container yalıtımı: Güvenilmeyen depolar veya bağımlılıklar için, VS Code
  Dev Container içinde çalışmak yerel durumdan bağımsız tam makine yalıtımı sağlar.

Bilinen sınırlama: snapshot ve checkpoint'ler yalnızca `write_file` / `edit_file`
ile doğrudan değiştirilen dosyaları kapsar. `execute_command` tarafından oluşturulan
veya değiştirilen dosyalar geri alma özelliğiyle geri alınamaz.

## Bağımlılık güvenliği

- Geliştirme bağımlılıkları sabitlenmiştir ve düzenli olarak denetlenir.
- `package.json` içindeki `@azure/msal-node: ^7.1.1` override'ı, `@vscode/vsce`
  üzerinden `@azure/identity` tarafından dolaylı çekilen eski 6.x sürümlerindeki
  bilinen açıkları hafifletir. Proje çalışma zamanında Azure servisleri kullanmaz.

## Desteklenen sürümler

Yalnızca en son yayımlanmış sürüm güvenlik düzeltmeleri alır. Kaynaktan
çalıştırıyorsanız `main` dalının en son commit'inde olduğunuzdan emin olun.
