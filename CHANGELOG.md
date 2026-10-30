# Sürüm Notları

Bu dosya kullanıcıları etkileyen önemli değişiklikleri kaydeder.

## [0.0.2] - 2026-10-30

> Bu sürüm henüz Marketplace'e yayımlanmadı.

Kod yazma akışı endüstriyel bir modül akışına dönüştürüldü; alt ajan devretmesi ve `.ahi` bilgi tabanı düzeltildi.

### Eklendi

- **Endüstriyel modül akışı (`update_module_plan`):** Ajan kod yazmadan önce işi katmanlı modüllere ayırıyor. Her modül bir katman (`shared`, `domain`, `infrastructure`, `application`, `interface`, `test`, `docs`), sahip olduğu dosya/dizin yolları, tek cümlelik sorumluluk, bağımlılıklar ve onu yazacak uzman rolü bildiriyor. Bağımlılık yönü alana doğrudur (interface → application → domain; infrastructure ve shared altta); katman ihlalleri ve döngüsel bağımlılıklar **kod yazılmadan** reddediliyor. Modüller katman sırasıyla yazılıyor.
- **Plan adımları modül ve kriterlere bağlandı:** `update_plan` artık `moduleId` ve `criteria` alanlarını kabul ediyor; modül haritası olmadan plan yazılamıyor, bilinmeyen modül/kriter kimliği reddediliyor. Böylece plan "yapılacaklar listesi" değil, sözleşmeye bağlı bir yol haritası oluyor.
- **Modül haritası arayüzde:** Besteci altındaki yeni `ModuleStrip`, modülleri katman sırasıyla, sahip rolü, yolları ve bağlı plan adımının durumuyla gösteriyor; plan onaylanana kadar `kod öncesi` işareti görünüyor.
- **Üç boyutlu kabul kriteri kapısı:** Spec onayı (manuel ve otonom) artık kabul kriterlerinin mutlu yol, hata yolu ve uç durum boyutlarını kapsamasını istiyor. Eksikse spec imzalanmıyor; model eksik kriterleri eklemek üzere açık bir sistem mesajıyla uyarılıyor.
- **Alt ajanları görünür kılan modül rolleri:** Plan adımlarındaki `ownerRole` ile devretme aynı dile bağlandı; her adımın sahibi uzman `invoke_subagent` ile çağrılabiliyor, eşgüdüm gerektiğinde `@manager` kullanılıyor.

### Düzeltilen

- **Alt ajanlar gerektiği yerde çalışmıyordu:** Üç ayrı engel vardı. (1) Araç hattı yalnızca `@manager` rolüne izin veriyordu, oysa sistem prompt'u "uzman rolünü doğrudan çağır" diyordu; çelişki kaldırıldı. (2) Okuma aşamalarında (spec/plan onayı öncesi) devretme araçları tamamen listeden çıkarıldığı için keşif için alt ajan başlatılamıyordu; artık `invoke_subagent` serbest, alt ajan salt-okunur araç setiyle çalışıyor. (3) Prompt "önemsiz işler dışında devret" diyecek kadar zayıftı; çok alanlı, üç ve daha fazla dosyaya dokunan işler için devretme varsayılan hâle getirildi.
- **`.ahi` bilgi tabanı okunmuyordu:** `KnowledgeStore.load()`, JSON indeksi yok ya da bozuksa erken dönüp `project.md`, `conventions.md`, `decisions.md` ve `notes.md` dosyalarını hiç yüklemiyordu. Bu yüzden `.ahi` dolu olsa bile ajan proje bilgisini görmeden her şeyi yeniden soruyordu. İnsan dosyaları artık indeksten bağımsız olarak her durumda yükleniyor; indeks yoksa depo haritası arka planda üretiliyor.
- **Test komutu bulunamayan projede görev sessizce kapanıyordu:** "Atlandı" durumundaki doğrulama "geçti" sayılıyordu; projede `test`/`lint` script'i yoksa görev hiç test çalışmadan "bitti" olabiliyordu. Artık atlanan doğrulama bitti kapısını yalnızca çalışma alanı hiç yokken tatmin ediyor; diğer durumlarda görev dürüstçe açık kalıyor.
- **Düzenlenen istem ikinci kez gönderiliyordu:** `editMessage` eklendi; düzenlenen mesajdan sonraki tüm turlar atılıp istem yerinde yeniden çalıştırılıyor.
- **Yeni sohbet önceki turu durduruyor:** Yeni sohbet başlatıldığında çalışan tur, bekleyen onay/soru ve alt ajan isteği aynı anda iptal ediliyor; yarım kalan tur arka planda sürüp durumu karıştırmıyor.

### Bilinen Sınırlamalar

- **Sohbetler arka planda sürdürülmüyor:** Bu sürümde aynı anda tek oturum çalışıyor; başka bir sohbete geçmek ya da yeni sohbet açmak çalışan turu (ve alt ajanları) durduruyor. Oturum başına ayrı ajan çalıştırma (arka planda devam) sonraki sürüme bırakıldı.
- **`execute_command` yan etkileri geri alınamaz:** Snapshot ve checkpoint yalnızca `write_file` / `edit_file` değişikliklerini kapsar.

## [0.0.1] - 2026-10-29

> Bu sürüm henüz Marketplace'e yayımlanmadı; aşağıdaki notlar yayına girecek
> 0.0.1 paketinin tam içeriğini tanımlar.

AhiCode'un ilk sürümü. Ahilik zanaat ahlakı, kalfalık şed kuşağı ve çağrı grafiği mimarisiyle güçlendirilmiş otonom yazılım geliştirme ajanı.

### Eklendi

- **Dil politikası artık kaynak kod yorumlarını da denetliyor:** `npm run check:language` yalnızca ajan dosyalarının İngilizce olduğunu değil, tam satır kod yorumlarının Türkçe olduğunu da doğruluyor. Denetim bilinçli olarak muhafazakârdır (yanlış pozitif üretmemek için yalnızca bariz İngilizce işlev sözcükleri aranır); kod, tanımlayıcılar ve log mesajları bilinçli olarak İngilizce kalıyor (AGENTS.md politikası).
- **Sohbet turları tek akordeonda toplanıyor:** Her kullanıcı istemi ve ona ait tüm asistan adımları artık tek bir yanıt bloğunda gösteriliyor. Blok çalışırken açık kalıyor, tur bitince kendiliğinden kapanıyor ve başlıkta yanıtın kısa özeti ile araç adımı sayısı yer alıyor. Böylece çok adımlı bir tur, art arda yazılmış ayrı mesajlar gibi görünmüyor. Mesajlara `turnId` alanı eklendi; eski kayıtlar kullanıcı mesajı sınırıyla geriye dönük uyumlu gruplanıyor.
- **EVREN kotası ve model çubuğu:** Sohbet alanının altına ince bir bilgi çubuğu eklendi. EVREN seçiliyken `GET /v1/quota` üzerinden günlük token kotası (kullanılan / sınır / kalan ve yüzde) gösteriliyor; tur bitiminde ve dakikada bir yenileniyor, elle yenileme düğmesi var. Model seçimi üstbilgiden bu çubuğa taşındı; üstbilgi yalnızca görev modunu ve durumu gösteriyor. Kota okunamazsa sohbet durmuyor, çubukta not görünüyor.
- **Token bütçesi (`ahiCode.maxTokensPerTask`):** Görev başına toplam token sınırı (varsayılan: 0 = sınırsız). Kontrol bir sonraki model çağrısından **önce** yapılır; duraklatılan turda yarım işlenmiş araç çağrısı ve boşa harcanan yanıt kalmaz. Bütçe yalnızca sağlayıcı kullanım (usage) bilgisi döndürüyorsa uygulanır. Ayarlar ekranına "Token bütçesi" alanı eklendi.
- **Otomatik devam sınırı ayarı (`ahiCode.maxContinuations`):** Otonom moddaki en fazla otomatik devam turu sayısı artık sabit değil, ayarlardan yapılandırılabilir (varsayılan: 12). Ayarlar ekranına "Otomatik devam sınırı" alanı eklendi.
- **Belgeler iki dilli ve eşitlendi:** Yalnızca topluluk belgeleri değil, `README`, `docs/**` ve yayın/gizlilik metinleri de İngilizce asıl + Türkçe karşılık (`*.tr.md`) olarak tutuluyor. Asıl dosyalar GitHub/Marketplace tarafından otomatik tanınan standart adlarını (`README.md`, `docs/*.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`) korur; dil politikası `AGENTS.md` ve `CONTRIBUTING*` içinde tek biçimde tanımlandı. Ayrıca iki dilli çiftler arasındaki içerik farkları (eksik bölümler, yanlış dosya adları, güncel olmayan test sayıları ve logo ölçüleri) giderildi.
- **Tasarım jetonları tema değişkenlerine bağlandı:** Gezinti, bağlantı, odak halkası, birincil düğme ve kullanıcı balonu artık sabit marka mavisi yerine VS Code tema değişkenlerini kullanıyor; kırmızı, yeşil veya yüksek karşıtlıklı bir temada arayüz maviye zorlanmıyor. Simgeler tek ölçekten (`ahi-icon-*`), metinler tek tipografi ölçeğinden (`ahi-text-*`) ve markdown başlıkları ortak `ahi-md-h*` sınıflarından boyutlanıyor; ekranlar arası font ve simge tutarsızlıkları kaldırıldı.
- **Paketleme hijyeni:** Marketplace simgesi yeni marka kimliğiyle 128×128 saydam PNG olarak yenilendi (223 KB → 11 KB), VSIX paketine çalışma zamanında gerekmeyen geliştirici dosyaları (`.nvmrc`, `.prettierignore` vb.) artık dahil edilmiyor; paket boyutu %39 küçüldü.
- **Yeni marka kimliği her yüzeye uygulandı:** AhiCode A markası (stilize "A" + `</>` kod parantezleri) Marketplace/aktivite çubuğu simgelerine, README başlığına ve arayüz içi `Logo` bileşenine işlendi. README başlığı artık tema duyarlıdır (`<picture>` ile açık temada `logo.png`, koyu temada `logo-dark.png`); böylece logodaki koyu lacivert yazı hiçbir temada kaybolmaz. Logolardaki saydam kenar boşlukları kırpıldı ve görsel oranı bozulmadan yeniden boyutlandırıldı.

### Düzeltilen

- **Mesaj düzenleme artık ikinci kez göndermiyor:** Düzenlenen istem, yeni bir kullanıcı balonu eklemek yerine o mesajdan sonraki tüm turları (yanıt, araç çağrıları, sonraki istemler) atıp yerinde yeniden çalıştırılıyor. Besteci düzenleme modunu ve "Vazgeç" eylemini gösteriyor; düzenleme sırasında geçmiş tek doğrusal sohbet olarak kalıyor.
- **Yeni sohbet önceki görevi arka planda bırakmıyor:** Yeni sohbet başlatıldığında çalışan tur, bekleyen onay/soru ve alt ajan istekleri aynı anda iptal ediliyor; durum sıfırlanıp yeni oturum açılıyor. Önceki görev çalışırken başlatılırsa bildirim bunu açıkça söylüyor.
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
