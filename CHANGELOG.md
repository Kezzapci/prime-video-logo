# Değişiklik Günlüğü

## v1.2.0

### Premium arayüz

Prime Video Logo arayüzü koyu mavi-altın görsel dilinde yeniden düzenlendi. Kart geçişleri, hover hareketleri, canlı durum noktaları, neon vurgu animasyonları, logo sürükleme efekti ve güncelleme bildirim animasyonları eklendi.

### Marka görünümü

Ana çalışma alanına büyük ve görünür bir marka imzası eklendi:

> TÜM HAKLARI UMUT SARIYER’E AİTTİR

### Otomatik onarım

Uygulama artık veri klasörü, seçili logo, çıktı klasörü, video worker ve FFmpeg durumunu kontrol eder. Eksik veya bozuk bileşenler için güvenli düzeltmeler denenir; teknik ayrıntılar yerel log dosyasına yazılır ve arayüzde ham hata çıktısı gösterilmez.

### Video motoru

Video işleme worker’ı daha düşük kaynak kullanımıyla çalışacak şekilde sınırlandırıldı. Birincil filtre başarısız olursa 9:16 çıktıyı koruyan güvenli bir fallback filtresi otomatik olarak denenir. Kullanıcıya anlaşılır hata mesajı gösterilir ve yarım çıktı dosyaları temizlenir.

### Güncelleme

Yeni sürüm, GitHub Releases üzerinden setup ve portable EXE olarak dağıtılır. Uygulama içi güncelleme hataları artık teknik GitHub yanıtlarını ekrana basmaz.

## v1.1.1

Logo ölçekleme ve 9:16 kadraj düzeltmeleri.

## v1.1.0

Arka plan video worker’ı, Edilmiş Videolar varsayılan çıktı klasörü ve durdurma akışı.
