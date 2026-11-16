# Cabut Nama dengan Firebase

Versi ini menggunakan Google Sign-In, Cloud Firestore, Cloud Functions di `asia-southeast1` dan Firebase Hosting. Program, senarai dan keputusan disimpan bersama untuk kegunaan antara peranti. Mana-mana akaun Google yang disahkan boleh mencipta program dan menyertai program sebagai peserta. Pencipta program sahaja boleh menukar tajuk, mengganti senarai, mereset pusingan atau membaca semua keputusan.

## Cara cabutan berfungsi

- Satu akaun Google boleh menuntut satu nama bagi setiap pusingan. Padanan bagi setiap senarai dijana secara rawak di pelayan untuk kumpulan ganjil dan genap. Setiap nama memberi kepada seorang penerima berbeza.
- Nama sendiri tidak boleh dipadankan. Keputusan dilepaskan dua saat selepas cabutan, menggunakan jam pelayan. Pengesahan menjadi muktamad selepas 10 saat walaupun peserta menutup tab. Cubaan berulang mengembalikan penerima asal.
- Pautan dan kod QR membuka paparan peserta bagi program yang sama selepas log masuk. Pilih **Pengguna** untuk menyertai cabutan atau **Penyelaras** untuk membuka panel Urusetia. Tab Urusetia muncul dalam mod Penyelaras. Peserta yang membuka halaman umum boleh menampal pautan program. Reset mengarkibkan pusingan terdahulu dan membuka pusingan baharu menggunakan ID program yang sama.
- **Pautan atau QR umum** membenarkan akaun Google yang disahkan memilih satu nama. **Terhad kepada e-mel berdaftar** memadankan akaun dengan satu nama yang diluluskan oleh urusetia. Kedua-duanya menggunakan pautan atau QR yang sama untuk semua peserta dalam satu program. Pilih jenis akses ketika mencipta program atau mengganti senarai. Untuk akses terhad, masukkan satu e-mel Google bagi setiap nama mengikut turutan. Program sedia ada menggunakan akses umum; penukaran kepada akses terhad melalui penggantian senarai membuka pusingan baharu. Program terhad kekal terhad apabila senarai diganti atau direset. Cipta program baharu jika perlu akses umum.
- Cabutan baharu menyimpan nama seperti yang tertera ketika cabutan dibuat. Pembetulan nama peserta selepas cabutan digunakan pada senarai semasa dan cabutan berikutnya, sementara rekod cabutan yang telah dibuat menyimpan ejaan asal. Nama lama dalam pusingan yang sama kekal diperuntukkan kepada baris asal. Untuk rekod lama, ejaan terakhir yang masih tersimpan menjadi rujukan.
- Satu senarai menyokong 2 hingga 250 nama. Data demo lama disimpan berasingan dalam pelayar. Tampal atau muat naik semula nama yang diperlukan ke Firebase.

## Uji pada komputer

Gunakan Node.js 22.13 atau lebih baharu dalam siri 22 dan Java 21. Buka PowerShell di folder yang mengandungi fail ini.

```powershell
npm ci
npm ci --prefix functions
npm run build
npm test
npx -y firebase-tools@latest emulators:exec --only auth,firestore,functions --project demo-cabutan-nama "node scripts/emulator-test.mjs"
npx -y firebase-tools@latest emulators:start --only auth,firestore,functions,hosting --project demo-cabutan-nama
```

Buka `http://127.0.0.1:5000/#/urus` dan gunakan akaun ujian Google yang disediakan oleh Auth Emulator.

## Terbitkan ke cabutan-nama

1. Sahkan projek `cabutan-nama` menggunakan Cloud Firestore Native, dengan pangkalan data `(default)`. Sahkan penyedia Google aktif dan domain Hosting yang digunakan tersenarai dalam Authentication → Settings → Authorized domains.
2. Pastikan projek menggunakan pelan Blaze untuk Cloud Functions. Semak tetapan dan Rules sedia ada sebelum deploy. Fail `firestore.rules` di sini menolak semua akses terus daripada klien; jika pangkalan data dikongsi dengan aplikasi lain, gabungkan peraturan dengan Rules sedia ada sebelum deploy.
3. Daripada folder projek, log masuk serta semak pangkalan data dan aplikasi web yang ditetapkan.

```powershell
npx -y firebase-tools@latest login
npx -y firebase-tools@latest projects:list
npx -y firebase-tools@latest firestore:databases:list --project cabutan-nama
npx -y firebase-tools@latest apps:list WEB --project cabutan-nama
npm run build
npx -y firebase-tools@latest deploy --only firestore:rules,functions --project cabutan-nama
```

4. Selepas menyemak Functions mengikut urutan penerbitan di bawah, terbitkan Hosting.

```powershell
npx -y firebase-tools@latest deploy --only hosting --project cabutan-nama
```

5. Buka `https://cabutan-nama.web.app/#/urus`. Mulakan dengan nama rekaan. Cipta satu program, imbas QR dengan telefon kedua, gunakan Google Sign-In pada kedua-dua telefon dan semak bahawa setiap cabutan unik, rekod urusetia boleh disegarkan serta keputusan kekal sama selepas log masuk semula. Pilih **Muat semula rekod** untuk mendapatkan kiraan terkini.

Penerbitan menggunakan Firebase CLI. Tiada GitHub Actions diperlukan.

Versi ini menulis dokumen tuntutan dan keputusan per peserta serta masih membaca rekod pusingan lama. Buat pertukaran versi ketika tiada sesi aktif supaya permintaan daripada dua versi Functions tidak menulis dalam format berbeza secara serentak. Terbitkan Functions dahulu dan sahkan aliran tempatan atau ujian di projek staging sebelum menerbitkan Hosting. Jika pemulihan diperlukan selepas versi ini digunakan, kekalkan Functions yang menyokong dokumen per peserta dan kawalan e-mel berdaftar sehingga data versi ini dapat diselaraskan.
