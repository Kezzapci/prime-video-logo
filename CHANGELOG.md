## v1.8.1 — Temiz çıktı başlıkları

- Çıktı dosya adlarından `_logo_9x16` ve `_logo_16x9` ekleri kaldırıldı; başlıkta yalnızca orijinal video adı kullanılır.
- 9:16 ve 16:9 çıktıları `Edilmiş Videolar\\9x16` ve `Edilmiş Videolar\\16x9` alt klasörlerinde saklanır; iki format birbirinin üzerine yazmaz.
- Aynı adlı farklı videolarda güvenli çakışma numarası kullanılır ve gerçek çıktı yolu işlem sonucunda gösterilir.

## v1.8.0 — Çift format çıktı sistemi

- Control Room ve Ayarlar ekranına çalışan 9:16 dikey / 16:9 yatay format seçici eklendi.
- Seçilen format ön izleme tuvaline, ölçü göstergelerine, logo sürükleme sınırlarına ve FFmpeg render zincirine anında uygulanır.
- 9:16 çıktılar 720 × 1280, 16:9 çıktılar 1280 × 720 olarak üretilir.
- Logo her iki tuvalde de kaynak en-boy oranını koruyarak video üstünde güvenli alana sığdırılır.
- Aynı kaynak video 9:16 ve 16:9 formatlarında ayrı ayrı işlenebilir; SHA-256 geçmiş anahtarı formatı da dikkate alır.
- AAC ses koruma, gerçek çıktı doğrulaması, Edilmiş Videolar klasörü ve tüm mevcut buton akışları korunur.

## v1.7.0 — Control Room arayüzü ve alt overlay

- Masaüstü arayüzü tamamen yeniden tasarlandı; Control Room ekranı, sayfa navigasyonu, command rail, durum kartları ve canlı kompozisyon alanı eklendi.
- Tüm görünür kontroller uçtan uca bağlandı: klasör seçme/açma, logo seçme, preset konumları, boyut/opaklık slider’ları, başlat/durdur, geçmiş temizleme, sistem onarımı, log açma, güncelleme, pencere küçültme/büyütme/kapatma.
- Logo artık varsayılan olarak videonun **üzerine**, alt-merkez güvenli bölgeye geniş dikdörtgen overlay olarak yerleşir; altına ayrı panel açılmaz.
- Logo kaynak oranı korunur, `setsar=1` uygulanır ve FFmpeg overlay ifadesi logo tamamen görünür kalacak şekilde `W-w` / `H-h` sınırlarına oturtulur.
- Eski üst-sağ varsayılan ayarlar güvenli biçimde alt-merkez yerleşime migrate edilir; kullanıcı yine sürükleyerek veya preset’lerle konumu değiştirebilir.
- Gerçek worker testinde 720×1280 H.264, AAC 48 kHz / 160 kbps çıktı ve `Masaüstü\\Edilmiş Videolar` akışı doğrulandı.

## v1.6.1 — Çıktı Klasörü Güvenlik Yaması

- İşlem başlamadan önce `Masaüstü\Edilmiş Videolar` çıktı klasörü otomatik oluşturulur.
- Çıktı klasörünün yazma izni işlem öncesi kontrol edilir.
- Worker, gerçek MP4 oluşmadan işlemi başarılı olarak işaretlemez.
- İşlem tamamlanınca gerçek done/skipped/error sayıları kullanıcıya gösterilir.
- Ayarlar ekranına doğrudan `Klasörü aç` düğmesi eklendi.
- Eski veya sembolik çıktı yolları güvenli biçimde varsayılan klasöre normalize edilir.

# Değişiklik Günlüğü

## v1.6.0 — Neo Studio ve oran kilitli logo render

- Masaüstü arayüzü baştan tasarlandı: Neo Studio kontrol odası, command rail, yeni metric kartları, canlı kompozisyon alanı ve daha okunaklı render kuyruğu eklendi.
- Yeni sinematik `neo-studio-bg.png` görsel varlığı ve responsive panel sistemi eklendi.
- Logo render filtresinde kaynak piksel en-boy oranı `setsar=1` ile sabitlendi; Lanczos ve `force_original_aspect_ratio=decrease` ile logo oranı korunarak ölçekleniyor.
- Ön izleme ve gerçek render aynı logo oranını kullanıyor; sürükleme ve köşe preset’leri logonun gerçek yüksekliğine göre güvenli alanda sınırlandırılıyor.
- Çıktı göstergeleri gerçek 720×1280 / 9:16 formatıyla eşitlendi.
- Sanal kuyruk, SHA-256 tekrar engeli, ses koruma, otomatik onarım ve public GitHub updater korunarak yeni kabuğa taşındı.

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

## v1.3.0

- 1000+ videoda arayüz kasmasını azaltan sanal liste ve lazy thumbnail kuyruğu eklendi.
- Ön izleme kareleri en fazla iki eşzamanlı FFmpeg işiyle kontrollü üretiliyor.
- Logo ön izlemede serbestçe sürüklenebiliyor; konum ve boyut ayarları render ile eşleştirildi.
- Orijinal ses akışı korunuyor; AAC, 48 kHz, 160 kbps ses çıkışı ve zaman damgası düzeltmesi eklendi.
- Video render için `superfast` preset ve otomatik thread kullanımı etkinleştirildi.
- Ses içermeyen videolar için de uyumlu çıktı akışı korundu.

## v1.4.0 — Public ve ultra sağlam güncelleme sistemi

- GitHub deposu public yapıldı; kurulu Windows uygulaması artık kullanıcı girişi olmadan Release ve latest.yml okuyabiliyor.
- Eski private-repo bağımlı electron-updater kaldırıldı.
- GitHub API ve latest.yml arasında yedekli güncelleme kontrolü eklendi.
- Setup indirmesinde HTTPS, yönlendirme sınırı, boyut limiti, Windows MZ doğrulaması ve SHA-512 checksum kontrolü eklendi.
- İndirme yarıda kalırsa geçici dosya temizleniyor ve kullanıcı dostu hata gösteriliyor.
- Güncelleme kurulumu uygulamayı güvenli şekilde kapatıp setup’ı sessiz kurulumla başlatıyor.
- FFmpeg ve gerekli Windows bileşenleri setup içine dahil edilmeye devam ediyor.

## v1.5.0 — Ultra Studio arayüzü

- Ana ekran tamamen yenilendi: ambient arka plan, premium dashboard, animasyonlu durum kartları ve üç panelli çalışma alanı.
- 500+ video için sanal kaynak listesi ve sanal render kuyruğu korundu; görünmeyen satırlar DOM’a yüklenmiyor.
- Thumbnail üretimi lazy kuyrukla sınırlandı; aynı anda en fazla iki ön izleme işi çalışıyor.
- 9:16 kompozisyon ön izlemesi, serbest logo sürükleme alanı ve marka hak sahipliği imzası yeni görsel kabuğa bağlandı.
- Otomatik onarım, GitHub public Release güncellemesi, ses koruma ve arka plan worker akışı korunarak yeni tasarıma taşındı.
- `ultra-ambient-bg.png` yeni premium görsel varlık olarak eklendi.
