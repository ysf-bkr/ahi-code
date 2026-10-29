# Sürüm Notları

Bu dosya kullanıcıları etkileyen önemli değişiklikleri kaydeder.

## [0.0.1] - 2026-10-28

AhiCode'un ilk sürümü. Ahilik zanaat ahlakı, kalfalık şed kuşağı ve çağrı grafiği mimarisiyle güçlendirilmiş otonom yazılım geliştirme ajanı.

### Öne Çıkanlar

- **Marka Kimliği & Logo:** Ahilik geleneğindeki şed kuşağı ve düğümü ile fonksiyon çağrı grafiği düğümlerini stilize "A" harfinde birleştiren, kenar boşluksuz vektörel logo (çini mavisi, Selçuklu turkuazı, Ahilik zanaat altını/bakır).
- **Mühendislik Titizliği & 3 Katmanlı Kabul Kriterleri:** Her görev için mutlu yol (happy path), hata yönetimi (sad path) ve uç durumlar / sınırlar (edge cases) katmanlarını zorunlu kılan savunmacı mühendislik standardı.
- **Orkestrasyon & Alt Ajan Mimarisi:** Yalnızca `@manager` (Yönetici) rolünün alt ajan başlatma (`invoke_subagent`, `run_parallel_tasks`) yetkisine sahip olduğu, uzman rollerin bağımsız çalıştığı orkestrasyon mimarisi.
- **Korumalı Çalışma Alanı (.ahi/):** Bellek, planlar, spec'ler, denetim günlüğü (`audit.log`) ve anlık görüntüler `.ahi/` klasörü altında izole ve güvenli tutulur.
- **Yerel ve Açık Kaynak Odaklı:** Varsayılan olarak Ollama ile hiçbir API anahtarı veya hesap gerektirmeden %100 yerel çalışma; OpenRouter ve OpenAI uyumlu uç nokta desteği.
