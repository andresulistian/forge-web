# Memasang patch Kanban di Mac

Patch ini dibuat dari arsip `forge-web-current.tar.gz` yang Anda kirim pada 25 September 2026. Berkas dalam patch ditimpa ke folder Forge yang sama; berkas proyek, database `.forge`, dan fitur lama tidak dihapus.

1. Hentikan Forge di Terminal dengan `Ctrl+C`.
2. Pastikan paket `forge-kanban-patch-2026-09-25.tar.gz` sudah berada di `~/Downloads`.
3. Jalankan:

```sh
cd /Users/andresulistian/Downloads/forge-web
tar -xzf /Users/andresulistian/Downloads/forge-kanban-patch-2026-09-25.tar.gz
npm ci
npm run check
npm start
```

Jika Terminal Forge menggunakan perintah launch tersendiri, jalankan kembali perintah itu setelah `npm run check`. Buka tab **Kanban** di workbench. Saat task masuk Review/Test, terapkan hasil di tab **Review**, lalu jalankan checks dari kartu Kanban untuk memindahkannya ke Done.

Backup kode sebelum Kanban tersedia pada branch GitHub `pre-kanban-backup-2026-09-25` di repository `andresulistian/forge-web-stable-20260920-062752`. Arsip kode tidak menyertakan `.forge`; simpan folder tersebut saat memperbarui Forge.
