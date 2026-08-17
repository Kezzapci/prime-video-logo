# Prime Video Logo

Prime Video Logo, Windows üzerinde klasördeki videoları seri olarak işleyen, 9:16 dikey çıktı oluşturan ve seçilen logoyu ön izleme üzerinde sürükleyerek konumlandırmaya izin veren masaüstü uygulamasıdır.

## Özellikler

Uygulama MP4, MOV, MKV, AVI, WEBM ve M4V videolarını tarar. Videolar 720×1280 9:16 tuvaline ortalanır, logo sağ üstte varsayılan olarak uygulanır ve çıktı `Masaüstü\PrimeVideoLogo` klasörüne yazılır. Ön izleme ekranında logo fareyle sürüklenebilir; boyut ve opaklık ayarlanabilir; hazır köşe konumları kullanılabilir. SHA-256 dosya parmak iziyle daha önce tamamlanan videolar otomatik atlanır ve geçmiş `history.json` içinde tutulur.

## Windows kurulumu

`PrimeVideoLogo-Setup-1.0.0.exe` dosyasını çalıştırın. Kurulum sihirbazı masaüstü ve Başlat menüsü kısayollarını oluşturur. Kurulum dizini değiştirilebilir. Uygulama verileri kaldırma sırasında silinmez; böylece işlem geçmişi korunur.

## GitHub üzerinden yeni sürüm yayımlama

Kaynak kodu GitHub deposuna gönderin ve sürüm etiketi oluşturun:

```bash
git add .
git commit -m "Yeni sürüm"
git push origin main
git tag v1.0.1
git push origin v1.0.1
```

`v*.*.*` etiketi GitHub Actions akışını çalıştırır. Akış Windows üzerinde FFmpeg'i indirir, setup ve portable EXE üretir ve dosyaları GitHub Releases bölümüne ekler. Uygulamanın **Ayarlar → GitHub güncellemeleri → Güncellemeleri Aç** düğmesi son yayımlanan setup dosyalarının bulunduğu Releases sayfasını açar.

## Yerel geliştirme

```bash
npm install
npm start
```

Windows setup üretmek için `vendor/ffmpeg/ffmpeg.exe` dosyasının mevcut olması gerekir:

```bash
npm run build:win
```

Üretilen setup ve portable EXE `dist/` klasörüne yazılır.

## Not

GitHub deposu özel ise Release sayfasını görüntülemek için Windows kullanıcısının ilgili GitHub hesabıyla giriş yapmış olması gerekir. Depoyu herkese açık yapmanız halinde uygulamadaki Releases bağlantısı giriş gerektirmeden çalışır.
