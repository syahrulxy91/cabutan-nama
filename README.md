# Cabut Nama dengan Firebase

Versi ini menggunakan Google Sign-In, Cloud Firestore, Cloud Functions di `asia-southeast1` dan Firebase Hosting. Program, senarai dan keputusan disimpan bersama untuk kegunaan antara peranti. Mana-mana akaun Google yang disahkan boleh mencipta program dan menyertai program sebagai peserta. Pencipta program sahaja boleh menukar tajuk, mengganti senarai, mereset pusingan atau membaca semua keputusan.

## Cara cabutan berfungsi

- Satu akaun Google boleh menuntut satu nama bagi setiap pusingan. Padanan bagi setiap senarai dijana secara rawak di pelayan untuk kumpulan ganjil dan genap. Setiap nama memberi kepada seorang penerima berbeza.
- Nama sendiri tidak boleh dipadankan. Keputusan dilepaskan dua saat selepas cabutan, menggunakan jam pelayan. Pengesahan menjadi muktamad selepas 10 saat walaupun peserta menutup tab. Cubaan berulang mengembalikan penerima asal.
- Pautan dan kod QR membuka paparan peserta bagi program yang sama selepas log masuk Google. Halaman umum menawarkan mod **Pengguna** untuk menampal pautan program dan mod **Penyelaras** untuk membuka panel Urusetia. Tab Urusetia muncul dalam mod Penyelaras. Reset mengarkibkan pusingan terdahulu dan membuka pusingan baharu menggunakan ID program yang sama.
- **Terhad kepada e-mel berdaftar** ialah pilihan lalai untuk program baharu dan penggantian senarai. Semak e-mel Google di sebelah setiap nama sebelum menyimpan. **Pautan atau QR umum** memerlukan pengesahan pilihan dan membenarkan akaun Google yang disahkan melihat senarai serta memilih satu nama yang tersedia. Pilihan akses untuk pusingan sedia ada kekal sehingga urusetia menggantikan senarai. Penggantian senarai membuka pusingan baharu. Program terhad kekal terhad apabila senarai diganti atau direset. Cipta program baharu jika perlu akses umum.
- Semua akaun Gmail peribadi boleh digunakan. Titik dan akhiran `+` dalam alamat Gmail diabaikan semasa memadankan e-mel, jadi `ali.baba@gmail.com` dan `alibaba@gmail.com` dikira sebagai akaun yang sama. Pada program terhad, peserta log masuk menggunakan alamat yang dipadankan dengan nama mereka oleh urus setia.
- Peserta hanya boleh membetulkan ejaan nama mereka. Perubahan dihadkan kepada beberapa aksara daripada nama asal yang dimuat naik oleh urusetia (sekurang-kurangnya 4 aksara, atau 40% panjang nama). Nama yang berbeza perlu dikemas kini oleh urusetia melalui muat naik senarai.
- Cabutan baharu menyimpan nama seperti yang tertera ketika cabutan dibuat. Pembetulan nama peserta selepas cabutan digunakan pada senarai semasa dan cabutan berikutnya, sementara rekod cabutan yang telah dibuat menyimpan ejaan asal. Nama lama dalam pusingan yang sama kekal diperuntukkan kepada baris asal. Untuk rekod lama, ejaan terakhir yang masih tersimpan menjadi rujukan.
- Satu senarai menyokong 2 hingga 250 nama. Had fail ialah 4 MB, dengan maksimum 100 halaman bagi PDF. Data demo lama disimpan berasingan dalam pelayar. Tampal atau muat naik semula nama yang diperlukan ke Firebase.

## Uji pada komputer

Gunakan Node.js 22.13 atau lebih baharu dalam siri 22 dan Java 21. Buka PowerShell di folder yang mengandungi fail ini.

```powershell
npm ci
npm ci --prefix functions
npm run build
npm test
npx -y firebase-tools@15.36.0 emulators:exec --only auth,firestore,functions --project demo-cabutan-nama "node scripts/emulator-test.mjs"
npx -y firebase-tools@15.36.0 emulators:start --only auth,firestore,functions,hosting --project demo-cabutan-nama
```

Buka `http://127.0.0.1:5000/#/urus` dan gunakan akaun ujian Google yang disediakan oleh Auth Emulator.

## Terbitkan ke cabutan-nama

1. Sahkan projek `cabutan-nama` menggunakan Cloud Firestore Native, dengan pangkalan data `(default)`. Sahkan penyedia Google aktif dan domain Hosting yang digunakan tersenarai dalam Authentication → Settings → Authorized domains.
2. Pastikan projek menggunakan pelan Blaze untuk Cloud Functions. Semak tetapan dan Rules sedia ada sebelum deploy. Fail `firestore.rules` di sini menolak semua akses terus daripada klien; jika pangkalan data dikongsi dengan aplikasi lain, gabungkan peraturan dengan Rules sedia ada sebelum deploy.
3. Daripada folder projek, log masuk serta semak pangkalan data dan aplikasi web yang ditetapkan.

```powershell
npx -y firebase-tools@15.36.0 login
npx -y firebase-tools@15.36.0 projects:list
npx -y firebase-tools@15.36.0 firestore:databases:list --project cabutan-nama
npx -y firebase-tools@15.36.0 apps:list WEB --project cabutan-nama
npm run build
npx -y firebase-tools@15.36.0 deploy --only firestore:rules,functions --project cabutan-nama
```

4. Selepas menyemak Functions mengikut urutan penerbitan di bawah, terbitkan Hosting.

```powershell
npx -y firebase-tools@15.36.0 deploy --only hosting --project cabutan-nama
```

5. Buka `https://cabutan-nama.web.app/#/urus`. Mulakan dengan nama rekaan. Cipta satu program, imbas QR dengan telefon kedua, gunakan Google Sign-In pada kedua-dua telefon dan semak bahawa setiap cabutan unik, rekod urusetia boleh disegarkan serta keputusan kekal sama selepas log masuk semula. Pilih **Muat semula rekod** untuk mendapatkan kiraan terkini.

Penerbitan menggunakan Firebase CLI. Tiada GitHub Actions diperlukan.

Versi ini menulis dokumen tuntutan dan keputusan per peserta serta masih membaca rekod pusingan lama. Buat pertukaran versi ketika tiada sesi aktif supaya permintaan daripada dua versi Functions tidak menulis dalam format berbeza secara serentak. Terbitkan Functions dahulu dan sahkan aliran tempatan atau ujian di projek staging sebelum menerbitkan Hosting. Jika pemulihan diperlukan selepas versi ini digunakan, kekalkan Functions yang menyokong dokumen per peserta dan kawalan e-mel berdaftar sehingga data versi ini dapat diselaraskan.


## Ukuran prestasi di emulator

Semua data ukuran prestasi ialah sintetik. Jalankan benchmark callable pada SyahVPS:

```bash
npx -y firebase-tools@15.36.0 emulators:exec --only auth,firestore,functions --project demo-cabutan-nama "node scripts/performance-benchmark.mjs"
```

Skrip membandingkan aliran list kemudian get dengan satu panggilan coordinator-entry untuk pilihan tersimpan, masa get peserta terhad, saiz respons JSON dan bilangan callable bagi 2, 3, 10, 100 dan 250 nama. coordinator-entry memeriksa katalog dan program secara selari selepas satu transaksi kuota yang menggunakan dua unit had sedia ada; backend mengesahkan pemilik sebelum memulangkan data.

Suite beban sedia ada boleh dijalankan dengan CABUT_LOAD_TEST=1 dan Auth/Firestore Emulator. Ia menggunakan akaun sintetik sahaja.

## Kawalan operasi dan penyimpanan

- Callable mengehadkan penciptaan kepada 30 program setiap akaun dalam satu hari UTC dan gabungan permintaan `list` serta `get` kepada 120 kali setiap akaun dalam satu minit. Tindakan yang mengubah data (tuntutan, cabutan, pengesahan, pembetulan nama dan tindakan urusetia) dihadkan kepada 60 kali setiap akaun dalam satu minit, dan reset atau penggantian senarai kepada 100 kali setiap akaun dalam satu hari UTC. Percubaan semula daripada penyerahan borang yang sama mengembalikan ID program asal jika penciptaan sudah disimpan. Pantau `resource-exhausted` dan kos tambahan transaksi kaunter dalam log.
- Dokumen operasi dan kuota mempunyai `expiresAt`. Dayakan TTL pada medan tersebut untuk kumpulan `cabutNamaCreateOperations` dan `cabutNamaQuotas` jika pemilik projek mahu membersihkan metadata sementara secara automatik. Semak status TTL di Firebase sebelum menganggap pembersihan aktif.
- Nama, e-mel, keputusan dan program disimpan selama 30 hari dari penciptaan program. Reset tidak memanjangkan tempoh. Peserta melihat notis sebelum menerima syarat undian dan penyelaras melihat tarikh tamat dalam panel program. Callable menyekat bacaan dan perubahan mulai waktu tamat. `purgeCabutNama` memeriksa baris gilir setiap lima minit dan memadam program serta subkoleksi. Pemadaman fizikal bergantung pada jadual dan kejayaan Cloud Scheduler. Kerja yang gagal dilog bersama ID program dan dicuba semula selepas 15 minit supaya tidak menyekat baris gilir. Maklumat akaun Firebase Auth global dan fail yang peserta muat turun tidak termasuk dalam pemadaman rekod program.
- Program terdahulu yang tiada tarikh tamat boleh diberi tempoh peralihan 30 hari apabila polisi dimaklumkan. Jalankan `node scripts/prepare-retention.cjs --project PROJECT_ID --start TARIKH_ISO_UTC` dengan akses Admin SDK bagi projek sasaran untuk melihat bilangan rekod yang terlibat. Selepas menyemak hasil dan tarikh, tambahkan `--apply` untuk menetapkan tarikh tamat dan memasukkan baris gilir. Arahan ini tidak memadam data. Jalankan dahulu di staging dan sahkan `purgeCabutNama` aktif selepas deploy Functions. Jangan gunakan Firestore TTL pada dokumen program kerana subkoleksi memerlukan pemadaman rekursif.
- Tetapkan pemboleh ubah `CABUT_LOAD_TEST=1` sebelum menjalankan suite emulator untuk menambah senario 100 peserta serentak. Ujian menggunakan akaun sintetik pada Auth Emulator dan melaporkan masa setiap fasa. Jalankan semakan tambahan selepas konfigurasi staging disahkan.
- Untuk Firebase App Check, daftarkan aplikasi web dan domain yang digunakan dengan reCAPTCHA Enterprise. Tetapkan `CABUT_APP_CHECK_SITE_KEY` pada shell sebelum `npm run build`. Jalankan Hosting dengan pembinaan tersebut, semak metrik dan uji aliran peserta di staging. Selepas trafik sah mendapat token, tetapkan parameter Functions `CABUT_ENFORCE_APP_CHECK=true` dalam `functions/.env.<project-id>` bagi sasaran yang disahkan dan terbitkan callable. Nilai lalai ialah `false` supaya klien sedia ada boleh terus digunakan sehingga pengaktifan disahkan.
- Cadangan CSP perlu diuji dalam mod laporan dengan hos sebenar yang digunakan oleh Firebase Auth, App Check, PDF worker, dan imej PNG. Gunakan dasar yang telah disahkan untuk domain pelepasan sebenar.
