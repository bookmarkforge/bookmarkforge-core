# Kullanıcı kılavuzu — BookmarkForge v1

**Sürüm:** 1.0.0 · **Son güncelleme:** Eylül 2026 · **Lisans:** MIT

## Başlarken

BookmarkForge yer işaretlerini, notları ve belgeleri kaydeder ve kişisel bilginizi düzenlemenize yardımcı olur. Kasanızın içeriği tarayıcının yerel depolamasında kalır ve BookmarkForge’a gönderilmez. Harici bir yapay zekâ sağlayıcısı yalnızca bu özelliğe açıkça gönderdiğiniz verileri alır.

Kasa AES-GCM ile yerel olarak şifrelenir; Argon2id anahtarı ana paroladan türetir. Destek ekibi kayıp parolayı kurtaramaz.

1. [bookmarkforgeapp.com](https://bookmarkforgeapp.com) adresini açın.
2. En az 12 karakterlik bir ana parola oluşturun.
3. 24 kurtarma kelimesini güvenli bir yerde saklayın.
4. Düzenli olarak şifreli `.bmf` yedeği dışa aktarın.

## Yer işaretleri ve arama

Free, kelime ve anlamla akıllı aramayı içerir. Free **2.500 yer işaretine** izin verir ve cihaz sayısını sınırlamaz; Pro eşzamanlaması yoksa her cihazın kendi kasası vardır. 2.500’e ulaşıldığında hiçbir şey silinmez: okuma, arama ve dışa aktarma devam eder, yalnızca yeni kayıtlar duraklatılır. Pro sınırı kaldırır ve P2P ile en fazla beş cihazı eşzamanlar.

## Pocket’tan içe aktarma

**Ayarlar → İçe aktar** bölümünde `ril_export.html` veya Pocket CSV dosyasını seçin. Kaydetmeden önce bağlantıların, tarihlerin ve etiketlerin önizlemesi gösterilir. Okundu, okunmadı ve arşivlendi durumları korunur. Free sınırına ulaşılırsa sonuç kaç öğenin aktarıldığını ve sınıra ulaşıldığını açıkça bildirir; kalanlar atlandı olarak sayılmaz.

## Notlar, AI ve eşzamanlama

Düzenleyici yapılandırılmış notları, tabloları ve belgeler arası bağlantıları destekler. WebLLM/Ollama yerel AI, RAG sohbeti, bilgi kartları ve P2P eşzamanlama Pro özellikleridir. Kendi API anahtarınızı kullandığınızda ilgili sağlayıcının koşulları geçerlidir.

## Yedekleme ve destek

Birden fazla `.bmf` kopyasını farklı yerlerde saklayın. Geri yükleme ana parolayı gerektirir. Kayıt reddedilirse Free sayacını kontrol edin; eşzamanlama sorununda ağı, güvenlik duvarını ve cihaz kimliklerini kontrol edin. Parolanızı veya kurtarma kelimelerinizi desteğe göndermeyin.

Destek: `bookmarkforge@proton.me`.

*Son güncelleme: Eylül 2026 · Sürüm 1.0.0*