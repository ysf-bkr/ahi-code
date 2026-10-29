# Marketplace yayını

Bu depo, VS Code Marketplace'e yayın için etiket tabanlı bir GitHub Actions akışı içerir.
Uzantı Marketplace'te yayımlanana kadar Marketplace kurulum bağlantısı kullanılamaz.

## Marketplace ve GitHub proje bilgileri

Marketplace sayfası uzantı manifestindeki metadata'yı ve depodaki `README.md` dosyasını kullanır.
Bu projede temel bilgiler tanımlıdır:

| Bilgi | Değer / kaynak |
| --- | --- |
| Uzantı kimliği | `ysf-bkr.ahi-code` (`publisher` + `name`) |
| Görünen ad ve kısa açıklama | `package.json` içindeki `displayName` ve `description` |
| Yayıncı | `ysf-bkr` |
| Simge | `resources/icon.png` |
| Lisans | `MIT` ve `LICENSE` dosyası |
| Kategori ve arama etiketleri | `package.json` içindeki `categories` ve `keywords` |
| Kurulum, kullanım, gizlilik ve destek bilgisi | GitHub ve Marketplace'te gösterilen kök `README.md` |
| Ayrıntılı veri işleme açıklaması | [`docs/PRIVACY.md`](./PRIVACY.md) |
| Değişiklik geçmişi | [`CHANGELOG.md`](../CHANGELOG.md) |
| Kaynak kodu ve hata bildirme | `package.json` içindeki `repository`, `homepage` ve `bugs` |

Bu bilgiler için ayrıca GitHub'a PAT veya gizli anahtar eklenmez. Yalnızca yayın otomasyonu için
gereken `VSCE_PAT`, GitHub deposunda **Settings → Secrets and variables → Actions** altında
secret olarak tutulur; değerini README'ye, issue'lara veya kaynak koduna eklemeyin.

Marketplace sayfası için kurulum adımları, sağlayıcı/veri akışı, gereksinimler ve destek adresi
README'de bulunmalıdır. Bu başlıklar kök README'ye eklenmiştir; yayın öncesinde açıklama, publisher,
simge ve lisansın doğru olduğunu tekrar kontrol edin.

## İlk yayın öncesi

1. Visual Studio Marketplace Publisher yönetiminde bir publisher oluşturun veya mevcut publisher'ı doğrulayın.
2. `package.json` içindeki `publisher` değeri, publisher kimliğiyle harfiyen eşleşmelidir. Doğrulanan kimlik `ysf-bkr` olarak ayarlanmıştır.
3. Azure DevOps'ta Marketplace yayınlama yetkisi olan bir Personal Access Token oluşturun.
4. Depodaki **Settings → Secrets and variables → Actions** bölümüne `VSCE_PAT` adlı repository secret ekleyin.
5. Token'ı kaynak dosyalara, commit'e, issue'lara veya sohbet mesajlarına koymayın.

## Yerel paket ve yayın

Paket oluşturmak için:

```bash
npm run package
```

Yayın öncesi VSIX dosyası `out/ahi-code-<sürüm>.vsix` konumuna yazılır. Yerel ortamda `VSCE_PAT`
tanımlıysa yayın komutu şudur:

```bash
npm run publish:ext
```

Komut, manifestteki sürümü kullanır ve derleme/paketleme sonrasında VSIX'i yayınlar. Marketplace
yayını geri alınması zor bir işlemdir; publisher ve sürüm bilgilerini önceden kontrol edin.

## GitHub Actions ile yayın

1. Değişiklikleri ve sürüm numarasını kontrol edip `package.json`, `package-lock.json` ve
   `webview-ui/package.json` sürümlerini birlikte güncelleyin.
2. Sürüm numarasıyla aynı etiketi oluşturup gönderin. Örnek:

```bash
git tag v0.1.0
git push origin v0.1.0
```

3. `v<package.json sürümü>` biçimiyle eşleşen etiket, `.github/workflows/marketplace.yml`
   iş akışını başlatır. İş akışı testleri çalıştırır, VSIX oluşturur ve `VSCE_PAT` ile Marketplace'e
   yayınlar.

Bir sürüm Marketplace'te yayımlandıktan ve kullanıcılar Marketplace kaynağından kurduktan sonra
VS Code'un uzantı otomatik güncelleme sistemi yeni sürümleri sunabilir. VSIX'ten elle kurulumda
otomatik güncelleme varsayılan olarak kapalıdır.

## Kullanıcıların Marketplace'ten kurulumu

İlk yayın tamamlandıktan sonra kullanıcılar:

1. VS Code'da **Extensions** görünümünü açıp `AhiCode` veya `ysf-bkr.ahi-code` aratabilir.
2. Yayıncının `ysf-bkr` olduğunu doğrulayıp **Install**'a tıklayabilir.
3. Terminalden `code --install-extension ysf-bkr.ahi-code` komutunu çalıştırabilir.

Uzantı Marketplace'te yayımlanmadan önce bu arama ve komut çalışmaz. O zamana kadar VSIX kurulumu
için README'deki yerel paketleme adımlarını kullanın.
