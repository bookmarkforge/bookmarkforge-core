# Panduan Pengguna — BookmarkForge v1

**Versi:** 1.0.0 · **Pembaruan terakhir:** September 2026 · **Lisensi:** MIT

## Memulai

BookmarkForge menyimpan bookmark, catatan, dan dokumen untuk membantu mengatur pengetahuan pribadi. Isi brankas tetap berada di penyimpanan lokal browser dan tidak dikirim ke BookmarkForge. Penyedia AI eksternal hanya menerima data yang Anda kirimkan secara jelas ke fitur tersebut.

Brankas dienkripsi secara lokal dengan AES-GCM dan kuncinya diturunkan dari kata sandi utama menggunakan Argon2id. Dukungan tidak dapat memulihkan kata sandi yang hilang.

1. Buka [bookmarkforgeapp.com](https://bookmarkforgeapp.com).
2. Buat kata sandi utama minimal 12 karakter.
3. Simpan 24 kata pemulihan di tempat aman.
4. Ekspor cadangan `.bmf` terenkripsi secara berkala.

## Bookmark dan pencarian

Free mencakup pencarian cerdas berdasarkan kata dan makna. Free mendukung **2.500 bookmark** tanpa batas jumlah perangkat; tanpa sinkronisasi Pro, setiap perangkat memiliki brankas sendiri. Saat mencapai 2.500, tidak ada data yang dihapus: membaca, mencari, dan mengekspor tetap tersedia, hanya penyimpanan baru yang dijeda. Pro menghapus batas tersebut dan menyinkronkan hingga lima perangkat melalui P2P.

## Impor dari Pocket

Buka **Pengaturan → Impor** lalu pilih `ril_export.html` atau CSV dari Pocket. Sebelum menyimpan, aplikasi menampilkan pratinjau tautan, tanggal, dan tag. Status sudah dibaca, belum dibaca, dan diarsipkan dipertahankan. Jika batas Free tercapai, hasilnya menyebutkan jumlah yang diimpor dan bahwa batas tercapai; sisanya tidak dihitung sebagai dilewati.

## Catatan, AI, dan sinkronisasi

Editor mendukung catatan terstruktur, tabel, dan tautan antardokumen. AI lokal WebLLM/Ollama, chat RAG, kartu belajar, dan sinkronisasi P2P adalah fitur Pro. Jika memakai kunci API sendiri, ketentuan penyedia terkait berlaku.

## Cadangan dan bantuan

Simpan beberapa salinan `.bmf` di lokasi berbeda. Pemulihan memerlukan kata sandi utama. Jika penyimpanan ditolak, periksa penghitung Free; jika sinkronisasi gagal, periksa jaringan, firewall, dan ID perangkat. Jangan pernah mengirim kata sandi atau kata pemulihan kepada dukungan.

Dukungan: `bookmarkforge@proton.me`.

*Pembaruan terakhir: September 2026 · Versi 1.0.0*