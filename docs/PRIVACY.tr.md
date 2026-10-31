# Gizlilik Bildirimi

**Türkçe** · [English](PRIVACY.md)

**Son güncelleme:** 30 Ekim 2026

AhiCode, Yusuf BEKAR tarafından bağımsız olarak geliştirilen açık kaynaklı bir
VS Code eklentisidir. Bu bildirim, eklentinin çalışma sırasında işlediği verileri
ve bu verilerin gidebileceği yerleri açıklar. Model sağlayıcılarının kendi
gizlilik ve saklama koşulları ayrıdır; bu belge onların uygulamalarını garanti
etmez.

## 1. Eklentinin işlediği veriler

- Sohbet mesajları, görev talimatları, model yanıtları ve araca verilen bağlam.
- Kullanıcı tarafından seçilen sağlayıcı, model ve uç nokta ayarları.
- Görev geçmişi ve görev özeti.
- Ajanın çalıştırdığı araçların adları, kararları ve redakte edilmiş argümanları.
- Kullanıcı tarafından açılan proje dosyaları ve `.ahi/` altında oluşturulan
  hafıza, kontrol noktası, denetim günlüğü ve doğrulama baseline'ı.

Eklenti, araca erişim izni verilen dosyaları okuyabilir. Okunan dosya içeriği
model bağlamına eklenmişse seçili model sağlayıcısına gönderilebilir. Hassas
verileri göndermeden önce çalışma alanını, seçili sağlayıcıyı ve eklentinin izin
ayarlarını kontrol edin.

## 2. Model sağlayıcılarına gönderim

İstek gönderildiğinde sohbet mesajları, model bağlamı ve ilgili araç tanımları
seçilen sağlayıcıya iletilir. Araç sonucu veya proje dosyası içeriği bağlama
eklenmişse bu içerikler de gönderilebilir.

- **Ollama (varsayılan):** İstekler ayarladığınız Ollama adresine gönderilir;
  varsayılan adres `http://localhost:11434` şeklindedir ve tamamen yerel çalışır.
- **EVREN LLM (SSYZ):** İstekler, girdiğiniz kimlik bilgileriyle EVREN API uç
  noktasına gönderilir.
- **OpenRouter:** İstekler `https://openrouter.ai/api/v1` adresine gönderilir ve
  oradan seçilen model sağlayıcısına yönlendirilebilir. OpenRouter'ın ve ilgili
  model sağlayıcısının koşulları geçerlidir.
- **OpenAI uyumlu uç nokta:** İstekler kullanıcı tarafından ayarlanan temel
  adrese gönderilir. Uzak sunucu kullanılıyorsa o sunucunun işletmecisi
  isteklere erişebilir.

AhiCode, bu üçüncü taraf hizmetlerin verileri ne kadar süre sakladığını veya
model eğitimi için kullanıp kullanmadığını belirlemez. Sağlayıcınızın güncel
koşullarını inceleyin.

## 3. Web araması, URL alma ve MCP

- `web_search` aracı, arama sorgusunu Tavily veya Brave'e (ilgili API anahtarı
  ortamda tanımlıysa) ya da DuckDuckGo'ya gönderir.
- `web_fetch` aracı kullanıldığında istenen URL'ye ağ isteği yapılır. Alınan
  sayfa içeriği görev bağlamına eklenebilir ve bu durumda model sağlayıcısına da
  gönderilebilir.
- MCP sunucuları kullanıcı tarafından yapılandırılır. MCP aracına verilen
  argümanlar ve araç çağrısının gerektirdiği proje verileri o MCP sunucusuna
  iletilebilir. Yalnızca güvendiğiniz sunucuları ekleyin ve kendi gizlilik
  koşullarını inceleyin.

## 4. Yerel saklama

- Sağlayıcı API anahtarları VS Code `SecretStorage` içinde saklanır; düz metin
  kullanıcı ayarlarına kaydedilmez.
- Ayarlar VS Code eklenti durum alanında saklanır. Görev geçmişi ve mesajlar
  VS Code `workspaceState` içinde yerel olarak saklanır.
- Proje hafızası, denetim günlüğü, checkpoint'ler ve doğrulama baseline'ı çalışma
  alanındaki `.ahi/` klasöründe tutulabilir. Bu klasörün içeriği kullanıcının
  proje ayarlarına göre Git'e eklenebilir; depodaki `.gitignore` bu yerel
  dosyaların çoğunu hariç tutar.
- VS Code Output kanalına tanılama mesajları yazılabilir. API anahtarları ve
  mesaj içerikleri kasıtlı olarak uygulama telemetrisi olarak gönderilmez.

Görev geçmişini eklentinin geçmiş ekranından silebilirsiniz. Proje içindeki
`.ahi/` kayıtlarını silmek veya saklamak kullanıcının ve proje bakım
sorumlusunun kontrolündedir.

## 5. Telemetri ve otomatik hata bildirimleri

Kod tabanında AhiCode tarafından işletilen analitik/telemetri gönderimi
bulunmamaktadır: kullanım sayacı, oturum kaydı veya profilleme verisi
toplanmaz ve gönderilmez.

Tek istisna dar kapsamlı bir dışa gönderimdir ve analitik değildir: **otomatik
hata bildirimleri**. Eklenti, kullanıcıya gösterdiği bir hatayla karşılaştığında,
bakım sorumlusunun düzeltebilmesi için AhiCode'ün herkese açık GitHub
deposunda (`ysf-bkr/ahi-code`) bir sorun (issue) açabilir.

- Denetim: `ahiCode.reportErrors` (varsayılan kapalı — etkinleştirme sizden).
  Siz açıkça açmadıkça bu özellik hiçbir şey göndermez; kapatınca tüm dış
  çağrıları durur.
- Taşıma: bildirimler kendi makinenizde kendi `gh` (GitHub CLI) oturumunuzla,
  o oturuma ait GitHub hesabı adına ve herkese açık olarak oluşturulur. `gh`
  kurulu veya giriş yapmış değilse hiçbir şey gönderilmez; eklenti bu özellik
  için kendi üstünde hiçbir GitHub kimliği tutmaz.
- İçerik: yalnızca hata mesajının kendisi ve kaba ortam bilgisi (eklenti
  sürümü, uygulama adı, platform, zaman). Gönderimden önce dosya yolları,
  API anahtarı benzeri diziler (`sk-`, `ghp_`, `xox`, `AIza…`, `Bearer …`
  jetonları), e-posta adresleri, URL sorgu dizileri, UUID'ler, uzun hex
  kimlikleri ve büyük sayılar maskelenir; metin kısaltılır. Sohbet dökümü,
  dosya içeriği ve kod asla eklenmez.
- Mükerrer koruması: her hata, yerelde saklanan ve issue gövdesine gömülen
  bir içerik parmak izi alır; aynı hata ikinci bir sorun açmaz.
- Bütçe: eklenti oturumu başına en fazla beş yeni sorun, aralarında bekleme
  süresiyle açılır.

Özellik varsayılan olarak kapalı geldiği için, `ahiCode.reportErrors`
ayarını kendiniz etkinleştirmedikçe hiçbir bildirim gönderilmez.

VS Code, model sağlayıcıları, web arama hizmetleri, MCP sunucuları veya
yapılandırdığınız başka hizmetlerin kendi veri uygulamaları bu bildirimin
kapsamı dışındadır.

## 6. Güvenlik ve çocukların gizliliği

API anahtarlarını, erişim belirteçlerini ve özel kodu herkese açık GitHub
issue'larına veya günlüklere eklemeyin. Eklenti, sağlayıcıya gönderilen veriler
üzerinde uçtan uca şifreleme ya da sağlayıcının saklamayacağı garantisi vermez.
AhiCode özellikle çocuklara yönelik tasarlanmamıştır.

## 7. İletişim ve değişiklikler

Gizlilik soruları için [ybekar@msn.com](mailto:ybekar@msn.com) adresine yazabilir
veya [GitHub Issues](https://github.com/ysf-bkr/ahi-code/issues) üzerinden
bildirim açabilirsiniz. Herkese açık issue'larda hassas veri paylaşmayın. Bu
bildirim, eklentinin veri işleme şekli değiştikçe güncellenecektir.
