# Sürüm Notları

Bu dosya kullanıcıları etkileyen önemli değişiklikleri kaydeder.

## [0.0.1] - 2026-10-29

> Bu sürüm henüz Marketplace'e yayımlanmadı; aşağıdaki notlar yayına girecek
> 0.0.1 paketinin tam içeriğini tanımlar.

AhiCode'un ilk sürümü. Ahilik zanaat ahlakı, kalfalık şed kuşağı ve çağrı grafiği mimarisiyle güçlendirilmiş otonom yazılım geliştirme ajanı.

### Eklendi

- **Dil politikası artık kaynak kod yorumlarını da denetliyor:** `npm run check:language` yalnızca ajan dosyalarının İngilizce olduğunu değil, tam satır kod yorumlarının Türkçe olduğunu da doğruluyor. Denetim bilinçli olarak muhafazakârdır (yanlış pozitif üretmemek için yalnızca bariz İngilizce işlev sözcükleri aranır); kod, tanımlayıcılar ve log mesajları bilinçli olarak İngilizce kalıyor (AGENTS.md politikası).
- **Token bütçesi (`ahiCode.maxTokensPerTask`):** Görev başına toplam token sınırı (varsayılan: 0 = sınırsız). Kontrol bir sonraki model çağrısından **önce** yapılır; duraklatılan turda yarım işlenmiş araç çağrısı ve boşa harcanan yanıt kalmaz. Bütçe yalnızca sağlayıcı kullanım (usage) bilgisi döndürüyorsa uygulanır. Ayarlar ekranına "Token bütçesi" alanı eklendi.
- **Otomatik devam sınırı ayarı (`ahiCode.maxContinuations`):** Otonom moddaki en fazla otomatik devam turu sayısı artık sabit değil, ayarlardan yapılandırılabilir (varsayılan: 12). Ayarlar ekranına "Otomatik devam sınırı" alanı eklendi.
- **Topluluk belgeleri iki dilli oldu:** `SECURITY.md`, `CONTRIBUTING.md` ve `CODE_OF_CONDUCT.md` İngilizce asılları olarak kalıyor (GitHub'ın bu adları otomatik tanıması için) ve yanlarında Türkçe karşılıkları (`SECURITY.tr.md`, `CONTRIBUTING.tr.md`, `CODE_OF_CONDUCT.tr.md`) bulunuyor.
- **Paketleme hijyeni:** Marketplace simgesi yeni marka kimliğiyle 128×128 saydam PNG olarak yenilendi (223 KB → 11 KB), VSIX paketine çalışma zamanında gerekmeyen geliştirici dosyaları (`.nvmrc`, `.prettierignore` vb.) artık dahil edilmiyor; paket boyutu %39 küçüldü.
- **Yeni marka kimliği her yüzeye uygulandı:** AhiCode A markası (stilize "A" + `</>` kod parantezleri) Marketplace/aktivite çubuğu simgelerine, README başlığına ve arayüz içi `Logo` bileşenine işlendi. README başlığı artık tema duyarlıdır (`<picture>` ile açık temada `logo.png`, koyu temada `logo-dark.png`); böylece logodaki koyu lacivert yazı hiçbir temada kaybolmaz. Logolardaki saydam kenar boşlukları kırpıldı ve görsel oranı bozulmadan yeniden boyutlandırıldı.

### Düzeltilen

- **Kabul kriterleri otomatik işaretlenmiyor:** Doğrulama (test/lint) geçtiğinde, metninde "test" veya "lint" geçen kriterler artık kendiliğinden "tamamlandı" sayılmıyor. Bir kriter yalnızca modelin açık `update_acceptance_criteria` kararıyla işaretlenir; işaretsiz kriter kaldıkça görev dürüstçe "bitti" kapanmıyor.
- **MCP stdio sunucularına ortam sırları sızması engellendi:** Miras kalan ortam değişkenleri artık komut ve hook'lardaki gibi ayıklanıyor (API anahtarı/token görünümlü değerler geçirilmiyor). Bir sunucuya anahtar gerekiyorsa `mcp_config.json` içindeki `env` alanıyla açıkça verilmeli.
- **Güvenli komut listesi argümanlarıyla ek kod çalıştırabiliyordu:** `rg --pre <betik>` harici işlemci çalıştırıyor, `git diff --output` dosya yazıyor, `git reflog expire` kurtarılabilir geçmişi siliyordu; `../` ve mutlak ev yolu içeren argümanlar çalışma alanı dışına erişiyordu. Ayrıca `npm start`, `npm run dev`, `npm run watch` ve `npx <paket>` depodan/registry'den keyfi kod çalıştırdığı için otomatik onaylanabilir komutlar arasından çıkarıldı; hepsi artık açık onay ister.
- **Hassas dosya koruması symlink ile aşılıyordu:** Çalışma alanı içindeki bir symlink (`alias.txt -> .env`) hassas hedefe alternatif ad sağlıyordu. İzin motoru artık istenen yolun yanında sembolik bağlar çözülmüş kanonik hedefi de denetliyor; okuma ve yazma aynı kararı alıyor.
- **`search_files`, proje `deny.readFiles` kurallarını uygulamıyordu:** Arama sonuçları artık `read_file` ile aynı izin kapısından geçiyor; deny kapsamındaki dosyaların içerikleri ripgrep ve Node yedek taramasında da sonuçlara girmiyor.
- **Alt ajanlar onay politikasını tutarsız uyguluyordu:** Alt ajan içindeki araç çağrıları hardcoded bir "değiştirici araç" listesiyle denetleniyordu; okuma onayı kapatıldığında ya da `web_fetch` gibi her zaman onay isteyen araçlarda ana ajan sözleşmesi geçerli olmuyordu. Karar artık ana ajanın politika tablosundan geliyor.
- **Komut geri alma sonradan yapılan kullanıcı işini silebiliyordu:** `git clean -fd`, komut bittikten sonra oluşturulan kullanıcı dosyalarını da siliyordu. Geri alma artık komutun bitiş anından sonra değişmiş dosyaları kullanıcı işi sayıyor, onları koruyor ve sonuç mesajında listeliyor.
- **Terminal sonuçları hatalı bildiriliyordu:** Çıkış kodu dinleyicisi çıktı okunduktan sonra kurulduğu için hızlı başarısız komut "başarılı" görünebiliyordu; zaman aşımı komutu terminalde çalışır bırakıyordu; entegrasyonsuz yolda komut yanlış dizinde başlayabiliyordu. Ayrıca çalışma dizini artık komut metnine çift tırnakla gömülmüyor (`$()` enjeksiyonu kapatıldı) ve farklı çalışma alanları için terminal yeniden kullanılmıyor.
- **Artımlı çağrı haritası dosyalar arası kenarları kaybediyordu:** Tek bir dosya kaydedildiğinde değişmeyen çağıranlara/dışındaki hedeflere giden ilişkiler düşüyordu. Güncelleme artık değişmeyen düğümleri çözümleme evreninde tutuyor ve değişen dosyaya komşu dosyaları yeniden sorguluyor; meta sayaçları da belgeyle eşitleniyor.
- **Checkpoint, `workflow` alanı olmayan görevlerde çöküyordu:** `state.workflow` bulunmayan görevlerde `JSON.parse(undefined)` hatası alınıyordu; alan artık isteğe bağlı kopyalanıyor.

### Öne Çıkanlar

- **Marka Kimliği & Logo:** Ahilik geleneğindeki şed kuşağı ve düğümü ile fonksiyon çağrı grafiği düğümlerini stilize "A" harfinde birleştiren, kenar boşluksuz tema duyarlı logo (çini mavisi, Selçuklu turkuazı, Ahilik zanaat altını/bakır); vektör marka işareti `icon-color.svg` içinde korunur.
- **Mühendislik Titizliği & 3 Katmanlı Kabul Kriterleri:** Her görev için mutlu yol (happy path), hata yönetimi (sad path) ve uç durumlar / sınırlar (edge cases) katmanlarını zorunlu kılan savunmacı mühendislik standardı.
- **Orkestrasyon & Alt Ajan Mimarisi:** Yalnızca `@manager` (Yönetici) rolünün alt ajan başlatma (`invoke_subagent`, `run_parallel_tasks`) yetkisine sahip olduğu, uzman rollerin bağımsız çalıştığı orkestrasyon mimarisi.
- **Korumalı Çalışma Alanı (.ahi/):** Bellek, planlar, spec'ler, denetim günlüğü (`audit.log`) ve anlık görüntüler `.ahi/` klasörü altında izole ve güvenli tutulur.
- **Yerel ve Açık Kaynak Odaklı:** Varsayılan olarak Ollama ile hiçbir API anahtarı veya hesap gerektirmeden %100 yerel çalışma; OpenRouter ve OpenAI uyumlu uç nokta desteği.
