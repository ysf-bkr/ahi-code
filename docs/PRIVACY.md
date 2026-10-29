# Gizlilik bildirimi

**Son güncelleme:** 28 Ekim 2026

AhiCode, Yusuf BEKAR tarafından bağımsız olarak geliştirilen açık kaynaklı bir VS Code
eklentisidir. Bu bildirim eklentinin çalışma sırasında işleyebildiği verileri ve bunların
gidebileceği yerleri açıklar. Model sağlayıcılarının kendi gizlilik ve saklama koşulları
ayrıdır; bu belge onların uygulamalarını garanti etmez.

## Eklentinin işlediği veriler

- Sohbet mesajları, görev talimatları, model yanıtları ve araca verilen bağlam.
- Kullanıcı tarafından seçilen sağlayıcı, model ve uç nokta ayarları.
- Görev geçmişi ve görev özeti.
- Ajanın çalıştırdığı araçların adları, kararları ve redakte edilmiş argümanları.
- Kullanıcı tarafından açılan proje dosyaları ve projede oluşturulan `.ahi/` hafıza, kontrol
  noktası ve doğrulama dosyaları.

Eklenti, araca erişim izni verilen dosyaları okuyabilir. Okunan dosya içeriği model bağlamına
eklenmişse seçili model sağlayıcısına gönderilebilir. Hassas verileri göndermeden önce
çalışma alanını, seçili sağlayıcıyı ve eklentinin izin ayarlarını kontrol edin.

## Model sağlayıcılarına gönderim

İstek gönderildiğinde sohbet mesajları, model bağlamı ve ilgili araç tanımları seçilen sağlayıcıya
iletilir. Araç sonucu veya proje dosyası içeriği bağlama eklenmişse bu içerikler de gönderilebilir.

- **Ollama:** İstekler ayarladığınız Ollama adresine gönderilir; varsayılan adres
  `http://localhost:11434` şeklindedir ve tamamen yerel çalışır.
- **OpenRouter:** İstekler `https://openrouter.ai/api/v1` adresine gönderilir ve oradan seçilen
  model sağlayıcısına yönlendirilebilir. OpenRouter'ın ve ilgili model sağlayıcısının koşulları
  geçerlidir.
- **OpenAI uyumlu uç nokta:** İstekler kullanıcı tarafından ayarlanan temel adrese gönderilir.
  Uzak sunucu kullanılıyorsa o sunucunun işletmecisi isteklere erişebilir.

AhiCode, bu üçüncü taraf hizmetlerin verileri ne kadar süre sakladığını veya model eğitimi için
kullanıp kullanmadığını belirlemez. Sağlayıcınızın güncel koşullarını inceleyin.

## Web araması, URL alma ve MCP

- `web_search` aracı arama sorgusunu Tavily veya Brave'e (ilgili API anahtarı ortamda
  tanımlanmışsa) ya da DuckDuckGo'ya gönderir.
- `web_fetch` aracı kullanıldığında istenen URL'ye ağ isteği yapılır. Alınan sayfa içeriği görev
  bağlamına eklenebilir ve bu durumda model sağlayıcısına da gönderilebilir.
- MCP sunucuları kullanıcı tarafından yapılandırılır. MCP aracına verilen argümanlar ve araç
  çağrısının gerektirdiği proje verileri o MCP sunucusuna iletilebilir. Yalnızca güvendiğiniz
  sunucuları ekleyin ve kendi gizlilik koşullarını inceleyin.

## Yerel saklama

- Sağlayıcı API anahtarları VS Code `SecretStorage` içinde saklanır; düz metin kullanıcı ayarlarına
  kaydedilmez.
- Ayarlar VS Code eklenti durum alanında saklanır. Görev geçmişi ve mesajlar VS Code
  `workspaceState` içinde yerel olarak saklanır.
- Proje hafızası, denetim günlüğü, checkpoint'ler ve doğrulama baseline'ı çalışma alanındaki
  `.ahi/` klasöründe tutulabilir. Bu klasörün içeriği kullanıcının proje ayarlarına göre Git'e
  eklenebilir; depodaki `.gitignore` bu yerel dosyaların çoğunu hariç tutar.
- VS Code Output kanalına tanılama mesajları yazılabilir. API anahtarları ve mesaj içerikleri
  kasıtlı olarak uygulama telemetrisi olarak gönderilmez.

Görev geçmişini eklentinin geçmiş ekranından silebilirsiniz. Proje içindeki `.ahi/` kayıtlarını
silmek veya saklamak kullanıcının ve proje bakım sorumlusunun kontrolündedir.

## Telemetri

Kod tabanında AhiCode tarafından işletilen analitik/telemetri gönderimi
bulunmamaktadır. VS Code, model sağlayıcıları, web arama hizmetleri, MCP sunucuları veya
yapılandırdığınız başka hizmetlerin kendi veri uygulamaları bu bildirimin kapsamı dışındadır.

## Güvenlik ve çocukların gizliliği

API anahtarlarını, erişim belirteçlerini ve özel kodu herkese açık GitHub issue'larına veya
günlüklere eklemeyin. Eklenti, sağlayıcıya gönderilen veriler üzerinde uçtan uca şifreleme ya da
sağlayıcının saklamayacağı garantisi vermez. AhiCode özellikle çocuklara yönelik tasarlanmamıştır.

## İletişim ve değişiklikler

Gizlilik soruları için [ybekar@msn.com](mailto:ybekar@msn.com) adresine yazabilir veya
[GitHub Issues](https://github.com/ysf-bkr/ahi-code/issues) üzerinden bildirim açabilirsiniz.
Herkese açık issue'larda hassas veri paylaşmayın. Bu bildirim, eklentinin veri işleme şekli
değiştikçe güncellenecektir.
