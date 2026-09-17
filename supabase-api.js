// ============================================================
// supabase-api.js
// Jembatan antara index.html dan Supabase
// Menggantikan fungsi sendRequest() dari Google Apps Script
// ============================================================

const SUPABASE_URL = 'https://avgpyvrkcgdeaobyfodi.supabase.co';
const SUPABASE_KEY = 'sb_publishable_-bgJC_KIPIBuJnpL87A1dQ_';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Helper: format tanggal hari ini (yyyy-mm-dd)
function _todayStr() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

// Helper: format tanggal+jam
function _nowStr() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Helper: parse jam "07:15" -> menit
function _parseJam(s) {
  if (!s || !s.includes(':')) return 0;
  const p = s.split(':');
  return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
}

// Helper: ambil config sesi dari tabel pengaturan
async function _getSesiList() {
  const { data } = await sb.from('pengaturan').select('*').like('key', 'Sesi_%');
  if (!data || !data.length) return [];
  return data.map(r => {
    const parts = String(r.value || '').split('|');
    return {
      sesi: r.key.replace('Sesi_', 'Sesi '),
      mulai: parts[0] || '07:00',
      batasTW: parts[1] || '07:15',
      tutup: parts[2] || '12:00',
      alpaSetting: parts[3] || 'Alpa',
      mulaiMin: _parseJam(parts[0]),
      batasTWMin: _parseJam(parts[1]),
      tutupMin: _parseJam(parts[2])
    };
  }).sort((a,b) => a.mulaiMin - b.mulaiMin);
}

// Helper: ambil setting by key
async function _getSetting(key, def) {
  const { data } = await sb.from('pengaturan').select('value').eq('key', key).maybeSingle();
  return data?.value || def;
}

// ============================================================
// ROUTER UTAMA - MENGGANTIKAN sendRequest
// ============================================================
window.sendRequest = function(payload, callback) {
  if (!payload || !payload.action) {
    return callback({ status: 'error', message: 'Payload tidak valid.' });
  }

  const action = payload.action;
  const routes = {
    login: () => handleLogin(payload),
    login_siswa_fingerprint: () => handleLoginSiswa(payload),
    absen_qr: () => handleAbsenQR(payload),
    input_izin: () => handleInputIzin(payload),
    cari_kehadiran: () => handleCariKehadiran(payload),
    rekap_kehadiran: () => handleRekapKehadiran(payload),
    get_kelas: () => handleGetKelas(),
    get_pengaturan: () => handleGetPengaturan(),
    save_pengaturan: () => handleSavePengaturan(payload),
    get_dashboard_data: () => handleGetDashboardData(),
    get_hari_libur: () => handleGetHariLibur(),
    save_hari_libur: () => handleSaveHariLibur(payload),
    delete_hari_libur: () => handleDeleteHariLibur(payload),
    get_filter_nilai: () => handleGetFilterNilai(payload),
    get_nilai: () => handleGetNilai(payload),
    save_nilai: () => handleSaveNilai(payload),
    get_daftar_nilai: () => handleGetDaftarNilai(payload),
    get_jadwal_mapel: () => handleGetJadwalMapel(payload),
    get_guru_profile: () => handleGetGuruProfile(payload),
    webauthn_register: () => handleWebAuthnRegister(payload),
    webauthn_login: () => handleWebAuthnLogin(payload),
    webauthn_check: () => handleWebAuthnCheck(payload),
    get_allowed_users: () => handleGetAllowedUsers(),
    update_allowed_users: () => handleUpdateAllowedUsers(payload),
    sync_allowed_users: () => handleSyncAllowedUsers(),
    check_session: () => handleCheckSession(payload),
    get_syarat_kelulusan: () => handleGetSyaratKelulusan(payload),
    get_setting_absen: () => handleGetSettingAbsen(),
    save_setting_absen: () => handleSaveSettingAbsen(payload),
    get_reset_fingerprint_list: () => handleGetResetFingerprintList(),
    reset_fingerprint: () => handleResetFingerprint(payload),
    get_reset_pin_list: () => handleGetResetPinList(),
    reset_pin: () => handleResetPin(payload),
    get_guru_pin_list: () => handleGetGuruPinList(),
    save_guru_pin: () => handleSaveGuruPin(payload),
    move_to_historis: () => ({ status: 'success', message: 'Fitur historis tidak aktif di versi Supabase.' }),
    setup_trigger: () => ({ status: 'success', message: 'Trigger otomatis dijalankan oleh Supabase Cron.' }),
    process_auto_absen: () => handleProcessAutoAbsen(),
    manual_auto_absen: () => handleProcessAutoAbsen(),
    ping: () => ({ status: 'success', message: 'pong' })
  };

  if (!routes[action]) {
    return callback({ status: 'error', message: 'Aksi tidak dikenal: ' + action });
  }

  // Jalankan handler dan kirim hasil ke callback
  Promise.resolve(routes[action]())
    .then(res => callback(res))
    .catch(err => {
      console.error('[Supabase Error]', action, err);
      callback({ status: 'error', message: 'Error: ' + (err.message || err) });
    });
};

// ============================================================
// HANDLER: LOGIN
// ============================================================
async function handleLogin(d) {
  const pin = String(d.pin || '').trim();
  if (!pin) return { status: 'error', message: 'PIN kosong!' };

  // 1. Cek guru
  const { data: guruData } = await sb.from('guru').select('*').eq('pin', pin).maybeSingle();
  if (guruData) {
    return {
      status: 'success', role: 'guru',
      nip: guruData.nip, nama: guruData.nama,
      mapel: String(guruData.mapel || '').split(',').map(m=>m.trim()).filter(Boolean),
      kelas: String(guruData.kelas || '').split(',').map(k=>k.trim()).filter(Boolean),
      message: 'Login Guru Berhasil!'
    };
  }

  // 2. Cek admin
  const pinAdmin = await _getSetting('PIN_Admin', '123456');
  const pinPengaturan = await _getSetting('PIN_Pengaturan', '456789');
  if (pin === pinPengaturan) return { status: 'success', role: 'super_admin', message: 'Login Super Admin Berhasil!' };
  if (pin === pinAdmin) return { status: 'success', role: 'admin', message: 'Login Admin Berhasil!' };
  return { status: 'error', message: 'PIN tidak valid!' };
}

async function handleLoginSiswa(d) {
  const nisn = String(d.nisn || '').trim();
  if (!nisn) return { status: 'error', message: 'NISN kosong!' };
  const { data } = await sb.from('siswa').select('*').eq('nisn', nisn).maybeSingle();
  if (!data) return { status: 'error', message: 'NISN tidak ditemukan!' };
  return {
    status: 'success', role: 'siswa',
    nisn: data.nisn, nama: data.nama, kelas: data.kelas,
    message: 'Login Siswa Berhasil!'
  };
}

// ============================================================
// HANDLER: ABSEN QR
// ============================================================
async function handleAbsenQR(d) {
  const role = String(d.role || '').toLowerCase().trim();
  const code = String(d.code || '').trim();
  const sesiKey = String(d.sesi || '').trim();
  if (!role || !code) return { status: 'error', message: 'Data tidak lengkap!' };

  const tabel = role === 'siswa' ? 'siswa' : 'guru';
  const kolom = role === 'siswa' ? 'nisn' : 'nip';
  const { data: user } = await sb.from(tabel).select('*').eq(kolom, code).maybeSingle();
  if (!user) return { status: 'error', message: `${role.toUpperCase()} ID ${code} tidak terdaftar!` };

  const today = _todayStr();

  // Cek hari libur
  const { data: libur } = await sb.from('hari_libur').select('*').eq('tanggal', today).maybeSingle();
  if (libur) return { status: 'danger', message: `Absensi Ditolak! Hari ini libur: ${libur.keterangan}` };

  // Cek sesi config
  const sesiList = await _getSesiList();
  const config = sesiList.find(s => s.sesi === sesiKey);
  if (config) {
    const curMin = new Date().getHours()*60 + new Date().getMinutes();
    if (curMin < config.mulaiMin) return { status: 'warning', message: `Belum waktunya absensi ${sesiKey}.` };
    if (curMin > config.tutupMin) return { status: 'danger', message: `Sesi Absensi ${sesiKey} Hari Ini Telah Selesai` };
  }
  const batasTWMin = config ? config.batasTWMin : 0;
  const curMin = new Date().getHours()*60 + new Date().getMinutes();
  const statusAbsen = curMin > batasTWMin ? 'TL (Terlambat)' : 'TW (Tepat Waktu)';

  // Cek sudah absen di sesi ini
  const { data: exist } = await sb.from('kehadiran')
    .select('id')
    .eq('id_user', code)
    .eq('tanggal', today)
    .like('sesi', `${sesiKey} -%`)
    .maybeSingle();
  if (exist) return { status: 'warning', message: `DITOLAK! ${user.nama} sudah absen pada ${sesiKey} hari ini.` };

  // Cek sesi sebelumnya (kalau alpa/bolos tidak boleh absen di sesi berikutnya)
  if (config) {
    const sesiIdx = sesiList.findIndex(s => s.sesi === sesiKey);
    for (let i = 0; i < sesiIdx; i++) {
      const prev = sesiList[i];
      const { data: prevAbsen } = await sb.from('kehadiran')
        .select('sesi')
        .eq('id_user', code)
        .eq('tanggal', today)
        .like('sesi', `${prev.sesi} -%`)
        .maybeSingle();
      if (prevAbsen) {
        const st = String(prevAbsen.sesi || '').toLowerCase();
        if (st.includes('alpa') || st.includes('bolos')) {
          const jenis = st.includes('bolos') ? 'Bolos' : 'Alpa';
          return { status: 'danger', message: `Ditolak, ${jenis} sesi sebelumnya (${prev.sesi})!` };
        }
      } else if (curMin > prev.tutupMin) {
        const jenis = prev.alpaSetting === 'Bolos' ? 'Bolos' : 'Alpa';
        return { status: 'danger', message: `Ditolak, ${jenis} sesi sebelumnya (${prev.sesi})!` };
      }
    }
  }

  // Insert ke kehadiran
  const { error } = await sb.from('kehadiran').insert({
    timestamp: _nowStr(),
    peran: role.toUpperCase(),
    id_user: code,
    nama_user: user.nama,
    sesi: `${sesiKey} - ${statusAbsen}`,
    tanggal: today
  });
  if (error) return { status: 'error', message: 'Gagal menyimpan: ' + error.message };

  return { status: 'success', message: `Absen Berhasil! ${user.nama} [${statusAbsen}]` };
}

// ============================================================
// HANDLER: INPUT IZIN
// ============================================================
async function handleInputIzin(d) {
  const role = String(d.role || 'siswa').toLowerCase();
  const id = String(d.id || '').trim();
  const status = String(d.status || '').trim();
  const ket = String(d.keterangan || '').trim();
  const tgl = String(d.tanggal || '').trim() || _todayStr();

  const tabel = role === 'siswa' ? 'siswa' : 'guru';
  const kolom = role === 'siswa' ? 'nisn' : 'nip';
  const { data: user } = await sb.from(tabel).select('*').eq(kolom, id).maybeSingle();
  if (!user) return { status: 'error', message: `ID ${id} tidak ditemukan!` };

  const statusLengkap = ket ? `${status} (${ket})` : status;
  const { error } = await sb.from('kehadiran').insert({
    timestamp: _nowStr(),
    peran: role.toUpperCase(),
    id_user: id,
    nama_user: user.nama,
    sesi: statusLengkap,
    tanggal: tgl
  });
  if (error) return { status: 'error', message: error.message };
  return { status: 'success', message: `Berhasil mencatat ${status} untuk ${user.nama}` };
}

// ============================================================
// HANDLER: PENGATURAN
// ============================================================
async function handleGetPengaturan() {
  const list = await _getSesiList();
  return {
    status: 'success',
    data: list.map(s => ({
      sesi: s.sesi, mulai: s.mulai, batasTW: s.batasTW,
      tutup: s.tutup, alpa: s.alpaSetting
    }))
  };
}

async function handleSavePengaturan(d) {
  const config = d.config || [];
  // Hapus sesi lama
  await sb.from('pengaturan').delete().like('key', 'Sesi_%');
  // Insert baru
  const rows = config.map((c, i) => ({
    key: `Sesi_${i+1}`,
    value: `${c.mulai}|${c.batasTW}|${c.tutup}|${c.alpa || 'Alpa'}`
  }));
  if (rows.length) {
    const { error } = await sb.from('pengaturan').insert(rows);
    if (error) return { status: 'error', message: error.message };
  }
  return { status: 'success', message: 'Pengaturan Sesi Berhasil Disimpan!' };
}

// ============================================================
// HANDLER: HARI LIBUR
// ============================================================
async function handleGetHariLibur() {
  const { data } = await sb.from('hari_libur').select('*').order('tanggal', { ascending: true });
  return {
    status: 'success',
    data: (data || []).map((r, i) => ({
      rowIndex: i + 1, id: r.id,
      tanggal: r.tanggal, keterangan: r.keterangan || ''
    }))
  };
}

async function handleSaveHariLibur(d) {
  const tgl = String(d.tanggal || '').trim();
  const ket = String(d.keterangan || '').trim();
  if (!tgl) return { status: 'error', message: 'Tanggal wajib diisi!' };
  const { error } = await sb.from('hari_libur').insert({ tanggal: tgl, keterangan: ket });
  if (error) return { status: 'error', message: error.message };
  return { status: 'success', message: 'Hari libur berhasil ditambahkan!' };
}

async function handleDeleteHariLibur(d) {
  const id = d.rowIndex; // Kita pakai id sebagai rowIndex di UI
  if (!id) return { status: 'error', message: 'ID tidak valid!' };
  const { error } = await sb.from('hari_libur').delete().eq('id', id);
  if (error) return { status: 'error', message: error.message };
  return { status: 'success', message: 'Hari libur berhasil dihapus!' };
}

// ============================================================
// HANDLER: DASHBOARD
// ============================================================
async function handleGetDashboardData() {
  const today = _todayStr();
  const now = new Date();
  const curMin = now.getHours()*60 + now.getMinutes();
  const sesiList = await _getSesiList();

  // Cek libur
  const { data: libur } = await sb.from('hari_libur').select('*').eq('tanggal', today).maybeSingle();
  const namaHari = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'][now.getDay()];

  if (libur) {
    const { count: cGuru } = await sb.from('guru').select('*', { count: 'exact', head: true });
    const { count: cSiswa } = await sb.from('siswa').select('*', { count: 'exact', head: true });
    return {
      status: 'success', isHariLibur: true,
      infoPesanSistem: `${namaHari} : ${libur.keterangan} , Tidak Ada Kegiatan Absensi`,
      totalGuru: cGuru || 0, totalSiswa: cSiswa || 0,
      stats: { guru: {tw:'0',tl:'0',sakit:'0',izin:'0',alpa:'0',bolos:'0'}, siswa: {tw:'0',tl:'0',sakit:'0',izin:'0',alpa:'0',bolos:'0'} },
      guruList: [], siswaList: [], sesiList: []
    };
  }

  // Ambil semua kehadiran hari ini
  const { data: kRows } = await sb.from('kehadiran').select('*').eq('tanggal', today);

  // Ambil semua guru & siswa
  const { data: gRows } = await sb.from('guru').select('*');
  const { data: sRows } = await sb.from('siswa').select('*');

  const scanMap = {};
  (kRows || []).forEach(r => {
    const key = `${r.id_user}_${r.peran}`;
    if (!scanMap[key]) scanMap[key] = [];
    scanMap[key].push({ jamScan: String(r.timestamp || '').substring(11, 19), sesiStatus: r.sesi });
  });

  // Tentukan status per sesi
  function buildStatus(records) {
    const arr = [];
    let propagated = '';
    for (const s of sesiList) {
      if (propagated) { arr.push(propagated); continue; }
      const found = records.find(r => r.sesiStatus.startsWith(s.sesi));
      if (found) {
        const st = found.sesiStatus;
        if (st.includes('TW')) arr.push('TW');
        else if (st.includes('TL')) arr.push('TL');
        else if (st.startsWith('Sakit')) { arr.push('Sakit'); propagated = 'Sakit'; }
        else if (st.startsWith('Izin')) { arr.push('Izin'); propagated = 'Izin'; }
        else if (st.includes('Alpa')) { arr.push('A'); propagated = 'A'; }
        else if (st.includes('Bolos')) { arr.push('B'); propagated = 'B'; }
        else arr.push('TW');
      } else if (curMin > s.tutupMin) {
        const code = s.alpaSetting === 'Bolos' ? 'B' : 'A';
        arr.push(code); propagated = code;
      } else arr.push('Belum Scan');
    }
    return arr;
  }

  const stats = {
    guru: { tw:[], tl:[], sakit:[], izin:[], alpa:[], bolos:[] },
    siswa: { tw:[], tl:[], sakit:[], izin:[], alpa:[], bolos:[] }
  };
  sesiList.forEach(() => {
    stats.guru.tw.push(0); stats.guru.tl.push(0); stats.guru.sakit.push(0);
    stats.guru.izin.push(0); stats.guru.alpa.push(0); stats.guru.bolos.push(0);
    stats.siswa.tw.push(0); stats.siswa.tl.push(0); stats.siswa.sakit.push(0);
    stats.siswa.izin.push(0); stats.siswa.alpa.push(0); stats.siswa.bolos.push(0);
  });

  function buildList(rows, peran, extraKey) {
    return (rows || []).map(r => {
      const id = peran === 'SISWA' ? r.nisn : r.nip;
      const records = scanMap[`${id}_${peran}`] || [];
      const arr = buildStatus(records);
      arr.forEach((st, idx) => {
        if (st === 'TW') stats[peran === 'SISWA'?'siswa':'guru'].tw[idx]++;
        else if (st === 'TL') stats[peran === 'SISWA'?'siswa':'guru'].tl[idx]++;
        else if (st === 'Sakit') stats[peran === 'SISWA'?'siswa':'guru'].sakit[idx]++;
        else if (st === 'Izin') stats[peran === 'SISWA'?'siswa':'guru'].izin[idx]++;
        else if (st === 'A') stats[peran === 'SISWA'?'siswa':'guru'].alpa[idx]++;
        else if (st === 'B') stats[peran === 'SISWA'?'siswa':'guru'].bolos[idx]++;
      });
      const obj = {
        id, nama: r.nama,
        jamScan: records.length ? records.map(x => x.jamScan).join(' | ') : '-',
        sesi: records.length ? records.map(x => x.sesiStatus.split(' - ')[0]).join(' | ') : '-',
        status: arr.join(' / ')
      };
      obj[extraKey] = r[extraKey] || '-';
      return obj;
    });
  }

  const guruList = buildList(gRows, 'GURU', 'mapel');
  const siswaList = buildList(sRows, 'SISWA', 'kelas');
  const fmt = arr => arr.join(' / ');

  let infoPesan = 'Sesi Aktif';
  const first = sesiList[0], last = sesiList[sesiList.length - 1];
  if (sesiList.length) {
    if (curMin < first.mulaiMin) infoPesan = `Sesi pertama (${first.sesi}) akan berlangsung jam ${first.mulai}-${first.tutup}.`;
    else if (curMin > last.tutupMin) infoPesan = `Sesi Scan Hari Ini Sudah Berakhir (Berakhir jam ${last.tutup})`;
    else {
      const active = sesiList.find(s => curMin >= s.mulaiMin && curMin <= s.tutupMin);
      infoPesan = active ? `Sesi Aktif: ${active.sesi} (${active.mulai} - ${active.tutup})` : 'Sesi Sedang Berlangsung';
    }
  }

  return {
    status: 'success', isHariLibur: false,
    totalGuru: (gRows || []).length, totalSiswa: (sRows || []).length,
    isSelesai: curMin > (last?.tutupMin || 0),
    isBelumMulai: curMin < (first?.mulaiMin || 0),
    isTabelBolehDitampilkan: true,
    infoPesanSistem: infoPesan,
    sesiList: sesiList.map(s => s.sesi),
    stats: {
      guru: { tw: fmt(stats.guru.tw), tl: fmt(stats.guru.tl), sakit: fmt(stats.guru.sakit), izin: fmt(stats.guru.izin), alpa: fmt(stats.guru.alpa), bolos: fmt(stats.guru.bolos) },
      siswa: { tw: fmt(stats.siswa.tw), tl: fmt(stats.siswa.tl), sakit: fmt(stats.siswa.sakit), izin: fmt(stats.siswa.izin), alpa: fmt(stats.siswa.alpa), bolos: fmt(stats.siswa.bolos) }
    },
    guruList, siswaList
  };
}

// ============================================================
// HANDLER: CARI & REKAP
// ============================================================
async function handleCariKehadiran(d) {
  const keyword = String(d.keyword || '').toLowerCase().trim();
  const tglMulai = String(d.tglMulai || '');
  const tglSelesai = String(d.tglSelesai || '');

  const { data: siswaRows } = await sb.from('siswa').select('*');
  const filtered = (siswaRows || []).filter(s => {
    if (!keyword) return true;
    return s.nisn.toLowerCase().includes(keyword) ||
           s.nama.toLowerCase().includes(keyword) ||
           String(s.kelas||'').toLowerCase().includes(keyword);
  });
  if (!filtered.length) return { status: 'success', data: [] };

  const ids = filtered.map(s => s.nisn);
  let q = sb.from('kehadiran').select('*').in('id_user', ids).eq('peran', 'SISWA');
  if (tglMulai) q = q.gte('tanggal', tglMulai);
  if (tglSelesai) q = q.lte('tanggal', tglSelesai);
  const { data: kRows } = await q;

  const result = (kRows || []).map(r => ({
    timestamp: r.timestamp, peran: r.peran, id: r.id_user,
    nama: r.nama_user, sesi: r.sesi, tanggal: r.tanggal
  }));
  // Tambahkan yang belum ada catatan
  filtered.forEach(s => {
    const ada = result.find(x => x.id === s.nisn);
    if (!ada) result.push({ timestamp: '-', peran: 'SISWA', id: s.nisn, nama: s.nama, sesi: 'Belum ada catatan kehadiran', tanggal: '-' });
  });
  return { status: 'success', data: result };
}

async function handleRekapKehadiran(d) {
  const role = String(d.role || 'siswa').toLowerCase();
  const kelas = String(d.kelas || '').trim();
  const tglMulai = String(d.tglMulai || '');
  const tglSelesai = String(d.tglSelesai || '');

  const tabel = role === 'siswa' ? 'siswa' : 'guru';
  const { data: dbRows } = await sb.from(tabel).select('*');
  const { data: liburRows } = await sb.from('hari_libur').select('tanggal');
  const liburSet = new Set((liburRows || []).map(r => String(r.tanggal).substring(0,10)));
  const sesiList = await _getSesiList();
  const jumlahSesiPerHari = sesiList.length || 1;

  let q = sb.from('kehadiran').select('*').eq('peran', role.toUpperCase());
  if (tglMulai) q = q.gte('tanggal', tglMulai);
  if (tglSelesai) q = q.lte('tanggal', tglSelesai);
  const { data: kRows } = await q;

  // Hitung total hari efektif
  const tglSet = new Set();
  (kRows || []).forEach(r => {
    const t = String(r.tanggal).substring(0,10);
    if (!liburSet.has(t)) tglSet.add(t);
  });
  const totalHari = tglSet.size || 1;
  const totalSesiEfektif = totalHari * jumlahSesiPerHari;

  const dataMap = {};
  (dbRows || []).forEach(r => {
    const id = role === 'siswa' ? r.nisn : r.nip;
    const unit = role === 'siswa' ? r.kelas : 'Guru';
    if (role === 'guru' || !kelas || unit === kelas) {
      dataMap[id] = { id, nama: r.nama, unit, tw:0, tl:0, izin:0, sakit:0, alpa:0, bolos:0, totalSesiTercatat:0, nilaiHadir:0, persentase:0 };
    }
  });
  (kRows || []).forEach(r => {
    const id = r.id_user;
    if (!dataMap[id]) return;
    const tgl = String(r.tanggal).substring(0,10);
    if (liburSet.has(tgl)) return;
    const st = String(r.sesi || '').toLowerCase();
    if (st.includes('tw')) dataMap[id].tw++;
    else if (st.includes('tl')) dataMap[id].tl++;
    else if (st.startsWith('izin')) dataMap[id].izin++;
    else if (st.startsWith('sakit')) dataMap[id].sakit++;
    else if (st.includes('alpa')) dataMap[id].alpa++;
    else if (st.includes('bolos')) dataMap[id].bolos++;
  });
  Object.values(dataMap).forEach(item => {
    item.totalSesiTercatat = item.tw + item.tl + item.sakit + item.izin + item.alpa + item.bolos;
    item.nilaiHadir = item.tw + item.tl + (item.sakit * 0.75) + (item.izin * 0.5);
    item.persentase = totalSesiEfektif > 0 ? ((item.nilaiHadir / totalSesiEfektif) * 100).toFixed(2) : '0.00';
  });
  return { status: 'success', data: Object.values(dataMap), totalHari, jumlahSesiPerHari, totalSesiEfektif };
}

// ============================================================
// HANDLER: KELAS
// ============================================================
async function handleGetKelas() {
  const { data } = await sb.from('siswa').select('kelas');
  const set = new Set((data || []).map(r => r.kelas).filter(Boolean));
  return { status: 'success', data: Array.from(set).sort() };
}

// ============================================================
// HANDLER: JADWAL MAPEL
// ============================================================
async function handleGetJadwalMapel(d) {
  const hariParam = String(d.hari || '').trim();
  const guruPin = String(d.pin || '').trim();
  const now = new Date();
  const hariIni = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'][now.getDay()];
  const target = hariParam || hariIni;

  const { data } = await sb.from('jadwal_mapel').select('*').eq('hari', target);
  let results = (data || []).map(r => ({ hari: r.hari, waktu: r.waktu, mapel: r.mapel, kelas: r.kelas }));
  results.sort((a,b) => String(a.waktu).split('-')[0].localeCompare(String(b.waktu).split('-')[0]));
  return { status: 'success', data: results, hari: target };
}

// ============================================================
// HANDLER: NILAI
// ============================================================
async function handleGetFilterNilai(d) {
  const pin = String(d.pin || '').trim();
  const { data: gRows } = await sb.from('guru').select('*');
  let mapelFilter = [], kelasFilter = [];
  if (pin) {
    const g = (gRows || []).find(x => x.pin === pin);
    if (g) {
      mapelFilter = String(g.mapel || '').split(',').map(m=>m.trim()).filter(Boolean);
      kelasFilter = String(g.kelas || '').split(',').map(k=>k.trim()).filter(Boolean);
    }
  }
  const mapelSet = new Set(), kelasSet = new Set();
  (gRows || []).forEach(g => {
    String(g.mapel || '').split(',').forEach(m => { const t = m.trim(); if (t) mapelSet.add(t); });
  });
  const { data: sRows } = await sb.from('siswa').select('kelas');
  (sRows || []).forEach(s => { if (s.kelas) kelasSet.add(s.kelas); });
  return {
    status: 'success',
    mapelList: mapelFilter.length ? mapelFilter : Array.from(mapelSet),
    kelasList: kelasFilter.length ? kelasFilter : Array.from(kelasSet),
    isGuruLogin: !!pin
  };
}

async function handleGetNilai(d) {
  const kelas = String(d.kelas || '').trim();
  let q = sb.from('siswa').select('*');
  if (kelas) q = q.eq('kelas', kelas);
  const { data } = await q;
  return {
    status: 'success',
    data: (data || []).map(s => ({ nisn: s.nisn, nama: s.nama, kelas: s.kelas, nilai: '' }))
  };
}

async function handleSaveNilai(d) {
  const guru = String(d.guru || '').trim();
  const mapel = String(d.mapel || '').trim();
  const jenisNilai = String(d.jenisNilai || 'NH1').trim().toUpperCase();
  if (!guru || !mapel) return { status: 'error', message: 'Guru dan Mapel wajib diisi!' };
  const rows = (d.listNilai || [])
    .filter(it => String(it.nilai || '').trim() !== '')
    .map(it => ({
      nisn: String(it.nisn).trim(), nama: it.nama, kelas: it.kelas,
      guru, mapel, jenis_nilai: jenisNilai, nilai: parseFloat(it.nilai) || 0
    }));
  if (!rows.length) return { status: 'warning', message: 'Tidak ada nilai yang diisi.' };
  const { error } = await sb.from('nilai').insert(rows);
  if (error) return { status: 'error', message: error.message };
  return { status: 'success', message: `Berhasil menyimpan ${rows.length} data nilai!` };
}

async function handleGetDaftarNilai(d) {
  const fGuru = String(d.guru || '').toLowerCase().trim();
  const fKelas = String(d.kelas || '').toLowerCase().trim();
  const fMapel = String(d.mapel || '').toLowerCase().trim();

  let q = sb.from('nilai').select('*');
  if (fMapel) q = q.ilike('mapel', `%${d.mapel}%`);
  if (fKelas) q = q.ilike('kelas', `%${d.kelas}%`);
  if (fGuru) q = q.ilike('guru', `%${d.guru}%`);
  const { data } = await q;
  if (!data || !data.length) return { status: 'success', headers: [], data: [] };

  const grouped = {};
  const headerSet = new Set();
  data.forEach(r => {
    const jenis = String(r.jenis_nilai || 'NH1').toUpperCase();
    headerSet.add(jenis);
    const key = `${r.nisn}_${r.guru}_${r.mapel}`;
    if (!grouped[key]) grouped[key] = { nisn: r.nisn, nama: r.nama, kelas: r.kelas, guru: r.guru, mapel: r.mapel, nilaiMap: {} };
    grouped[key].nilaiMap[jenis] = parseFloat(r.nilai) || 0;
  });
  const headers = Array.from(headerSet).sort();
  const totalKolom = headers.length || 1;
  const result = Object.values(grouped).map(item => {
    const vals = headers.map(h => item.nilaiMap[h] !== undefined ? item.nilaiMap[h] : 0);
    const total = vals.reduce((a,b) => a+b, 0);
    item.rataRata = (total / totalKolom).toFixed(2);
    item.nilaiList = vals;
    return item;
  });
  return { status: 'success', headers, data: result };
}

// ============================================================
// HANDLER: GURU PROFILE
// ============================================================
async function handleGetGuruProfile(d) {
  const pin = String(d.pin || '').trim();
  const { data } = await sb.from('guru').select('*').eq('pin', pin).maybeSingle();
  if (!data) return { status: 'error', message: 'Data guru tidak ditemukan!' };
  return { status: 'success', nama: data.nama, nip: data.nip, fotoFile: `${data.nip}.jpg` };
}

// ============================================================
// HANDLER: WEBAUTHN (Sidik Jari)
// ============================================================
async function handleWebAuthnRegister(d) {
  const userId = String(d.userId || '').trim();
  const userName = String(d.userName || '').trim();
  const credentialId = String(d.credentialId || '').trim();
  const publicKey = String(d.publicKey || '').trim();
  if (!userId || !credentialId || !publicKey) return { status: 'error', message: 'Data tidak lengkap!' };
  const { error } = await sb.from('webauthn').upsert({
    user_id: userId, nama: userName, credential_id: credentialId, public_key: publicKey
  }, { onConflict: 'user_id' });
  if (error) return { status: 'error', message: error.message };
  return { status: 'success', message: 'Sidik jari berhasil didaftarkan!' };
}

async function handleWebAuthnLogin(d) {
  const userId = String(d.userId || '').trim();
  const { data } = await sb.from('webauthn').select('*').eq('user_id', userId).maybeSingle();
  if (!data || !data.credential_id) return { status: 'error', message: 'User belum mendaftarkan sidik jari!' };
  return { status: 'success', credentialId: data.credential_id, publicKey: data.public_key };
}

async function handleWebAuthnCheck(d) {
  const userId = String(d.userId || '').trim();
  const { data } = await sb.from('webauthn').select('*').eq('user_id', userId).maybeSingle();
  if (!data) return { status: 'success', registered: false };
  return { status: 'success', registered: !!(data.credential_id && data.public_key), userName: data.nama };
}

// ============================================================
// HANDLER: ALLOWED USERS
// ============================================================
async function handleGetAllowedUsers() {
  const { data } = await sb.from('allowed_users').select('*');
  if (!data || !data.length) {
    // Auto-populate
    const { data: gRows } = await sb.from('guru').select('*');
    const { data: sRows } = await sb.from('siswa').select('*');
    const rows = [];
    (gRows || []).forEach(g => rows.push({ id: g.nip, nama: g.nama, role: 'guru', allowed: true }));
    (sRows || []).forEach(s => rows.push({ id: s.nisn, nama: s.nama, role: 'siswa', allowed: true }));
    if (rows.length) await sb.from('allowed_users').insert(rows);
    return { status: 'success', data: rows.map(r => ({ ...r, lastUpdated: new Date().toISOString() })) };
  }
  return { status: 'success', data: data.map(r => ({ id: r.id, nama: r.nama, role: r.role, allowed: !!r.allowed, lastUpdated: r.updated_at })) };
}

async function handleUpdateAllowedUsers(d) {
  const userId = String(d.userId || '').trim();
  const allowed = d.allowed === true || d.allowed === 'true';
  if (!userId) return { status: 'error', message: 'User ID kosong!' };
  const { error } = await sb.from('allowed_users').update({ allowed, updated_at: new Date().toISOString() }).eq('id', userId);
  if (error) return { status: 'error', message: error.message };
  return { status: 'success', message: allowed ? 'User diizinkan!' : 'User ditolak!' };
}

async function handleSyncAllowedUsers() {
  const { data: gRows } = await sb.from('guru').select('*');
  const { data: sRows } = await sb.from('siswa').select('*');
  const { data: existing } = await sb.from('allowed_users').select('id');
  const existingSet = new Set((existing || []).map(r => r.id));
  const rows = [];
  (gRows || []).forEach(g => { if (!existingSet.has(g.nip)) rows.push({ id: g.nip, nama: g.nama, role: 'guru', allowed: true }); });
  (sRows || []).forEach(s => { if (!existingSet.has(s.nisn)) rows.push({ id: s.nisn, nama: s.nama, role: 'siswa', allowed: true }); });
  if (rows.length) await sb.from('allowed_users').insert(rows);
  return { status: 'success', message: `Sinkronisasi selesai! ${rows.length} user baru ditambahkan.` };
}

// ============================================================
// HANDLER: SESSION
// ============================================================
async function handleCheckSession(d) {
  // Di Supabase versi sederhana, kita anggap session selalu valid
  // karena frontend pakai sessionStorage
  const userId = String(d.userId || '').trim();
  const role = String(d.role || '').trim();
  if (!userId || !role) return { status: 'error', message: 'Session tidak valid!' };
  if (role === 'guru') {
    const { data } = await sb.from('guru').select('*').eq('nip', userId).maybeSingle();
    if (data) return { status: 'success', role, userData: {
      nip: data.nip, nama: data.nama,
      mapel: String(data.mapel||'').split(',').map(m=>m.trim()).filter(Boolean),
      kelas: String(data.kelas||'').split(',').map(k=>k.trim()).filter(Boolean)
    }, message: 'Session valid!' };
  } else if (role === 'siswa') {
    const { data } = await sb.from('siswa').select('*').eq('nisn', userId).maybeSingle();
    if (data) return { status: 'success', role, userData: { nisn: data.nisn, nama: data.nama, kelas: data.kelas }, message: 'Session valid!' };
  }
  return { status: 'success', role, userData: null, message: 'Session valid!' };
}

// ============================================================
// HANDLER: SYARAT KELULUSAN
// ============================================================
async function handleGetSyaratKelulusan(d) {
  const nisn = String(d.nisn || '').trim();
  if (!nisn) return { status: 'error', message: 'NISN tidak valid!' };
  const { data: user } = await sb.from('siswa').select('*').eq('nisn', nisn).maybeSingle();
  if (!user) return { status: 'error', message: 'Siswa tidak ditemukan!' };

  const tglMulai = await _getSetting('Tgl_Mulai_Absen', '');
  const tglAkhir = await _getSetting('Tgl_Akhir_Absen', '');
  const batasPersen = parseFloat(await _getSetting('Batas_Persen_Hadir', '80'));
  if (!tglMulai || !tglAkhir) return { status: 'not_configured', message: 'Seting Absen belum dikonfigurasi.' };

  const { data: liburRows } = await sb.from('hari_libur').select('tanggal');
  const liburSet = new Set((liburRows || []).map(r => String(r.tanggal).substring(0,10)));

  const { data: kRows } = await sb.from('kehadiran')
    .select('*').eq('id_user', nisn).eq('peran', 'SISWA')
    .gte('tanggal', tglMulai).lte('tanggal', tglAkhir);

  const sesiList = await _getSesiList();
  const jumlahSesiPerHari = sesiList.length || 1;

  // Hitung hari efektif
  const hariEfektifSet = new Set();
  let cur = new Date(tglMulai + 'T00:00:00');
  const end = new Date(tglAkhir + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  const effEnd = end > today ? today : end;
  while (cur <= effEnd) {
    const s = cur.toISOString().substring(0,10);
    if (!liburSet.has(s)) hariEfektifSet.add(s);
    cur.setDate(cur.getDate() + 1);
  }

  const stats = { tw:0, tl:0, sakit:0, izin:0, alpa:0, bolos:0 };
  (kRows || []).forEach(r => {
    const tgl = String(r.tanggal).substring(0,10);
    if (liburSet.has(tgl)) return;
    const st = String(r.sesi || '').toLowerCase();
    if (st.includes('tw')) stats.tw++;
    else if (st.includes('tl')) stats.tl++;
    else if (st.startsWith('sakit')) stats.sakit++;
    else if (st.startsWith('izin')) stats.izin++;
    else if (st.includes('alpa')) stats.alpa++;
    else if (st.includes('bolos')) stats.bolos++;
  });

  const totalSesiTercatat = stats.tw + stats.tl + stats.sakit + stats.izin + stats.alpa + stats.bolos;
  const nilaiHadir = stats.tw + stats.tl + (stats.sakit * 0.75) + (stats.izin * 0.5);
  const persen = totalSesiTercatat > 0 ? (nilaiHadir / totalSesiTercatat) * 100 : 0;
  const isKelas9 = user.kelas.trim().startsWith('9');
  const memenuhi = persen >= batasPersen;
  const pesan = isKelas9 ? (memenuhi ? 'MEMENUHI SYARAT LULUS' : 'TIDAK MEMENUHI SYARAT LULUS') : (memenuhi ? 'MEMENUHI SYARAT NAIK KELAS' : 'TIDAK MEMENUHI SYARAT NAIK KELAS');
  const warna = persen >= batasPersen ? 'hijau' : (persen >= batasPersen - 2 ? 'kuning' : 'merah');

  return {
    status: 'success',
    data: {
      nisn, nama: user.nama, kelas: user.kelas,
      periodeMulai: tglMulai, periodeAkhir: tglAkhir,
      jumlahHariEfektif: hariEfektifSet.size, jumlahSesiPerHari,
      totalSesiEfektif: totalSesiTercatat, totalSesiTercatat,
      batasPersen, ...stats,
      nilaiHadir: nilaiHadir.toFixed(2), persen: persen.toFixed(2),
      memenuhi, warna, pesan, isKelas9
    }
  };
}

// ============================================================
// HANDLER: SETTING ABSEN
// ============================================================
async function handleGetSettingAbsen() {
  return {
    status: 'success',
    data: {
      mulai: await _getSetting('Tgl_Mulai_Absen', ''),
      akhir: await _getSetting('Tgl_Akhir_Absen', ''),
      batas: parseInt(await _getSetting('Batas_Persen_Hadir', '80'), 10)
    }
  };
}

async function handleSaveSettingAbsen(d) {
  const updates = {
    'Tgl_Mulai_Absen': String(d.mulai || '').trim(),
    'Tgl_Akhir_Absen': String(d.akhir || '').trim(),
    'Batas_Persen_Hadir': String(d.batas || '80').trim()
  };
  for (const [key, value] of Object.entries(updates)) {
    await sb.from('pengaturan').upsert({ key, value }, { onConflict: 'key' });
  }
  return { status: 'success', message: 'Seting Absen berhasil disimpan!' };
}

// ============================================================
// HANDLER: RESET FINGERPRINT & PIN
// ============================================================
async function handleGetResetFingerprintList() {
  const { data: wRows } = await sb.from('webauthn').select('*');
  const reg = {};
  (wRows || []).forEach(r => { if (r.credential_id && r.public_key) reg[r.user_id] = true; });
  const { data: gRows } = await sb.from('guru').select('*');
  const { data: sRows } = await sb.from('siswa').select('*');
  const list = [];
  (gRows || []).forEach(g => list.push({ id: g.nip, nama: g.nama, role: 'guru', registered: !!reg[g.nip] }));
  (sRows || []).forEach(s => list.push({ id: s.nisn, nama: s.nama, role: 'siswa', registered: !!reg[s.nisn] }));
  return { status: 'success', data: list };
}

async function handleResetFingerprint(d) {
  const userIds = d.userIds || [];
  if (!userIds.length) return { status: 'error', message: 'Tidak ada user dipilih!' };
  const { error } = await sb.from('webauthn').update({ credential_id: null, public_key: null }).in('user_id', userIds);
  if (error) return { status: 'error', message: error.message };
  // Log
  for (const uid of userIds) {
    await sb.from('log_reset').insert({ jenis: 'Sidik Jari', user_id: uid, nama: '-', role: '-' });
  }
  return { status: 'success', message: `${userIds.length} data sidik jari berhasil direset.` };
}

async function handleGetResetPinList() {
  const { data } = await sb.from('guru').select('*');
  return {
    status: 'success',
    data: (data || []).map(g => ({ id: g.nip, nama: g.nama, role: 'guru', pinSet: !!g.pin }))
  };
}

async function handleResetPin(d) {
  const userIds = d.userIds || [];
  if (!userIds.length) return { status: 'error', message: 'Tidak ada user dipilih!' };
  const { error } = await sb.from('guru').update({ pin: '' }).in('nip', userIds);
  if (error) return { status: 'error', message: error.message };
  for (const uid of userIds) {
    await sb.from('log_reset').insert({ jenis: 'PIN Guru', user_id: uid, nama: '-', role: 'guru' });
  }
  return { status: 'success', message: `${userIds.length} PIN guru berhasil direset.` };
}

// ============================================================
// HANDLER: GURU PIN LIST & SAVE
// ============================================================
async function handleGetGuruPinList() {
  const { data } = await sb.from('guru').select('*');
  return {
    status: 'success',
    data: (data || []).map(g => ({
      id: g.nip, nama: g.nama, hasPin: !!g.pin,
      pinMasked: g.pin ? '*'.repeat(Math.min(g.pin.length, 6)) : '(kosong)'
    }))
  };
}

async function handleSaveGuruPin(d) {
  const userId = String(d.userId || '').trim();
  const pin = String(d.pin || '').trim();
  if (!userId) return { status: 'error', message: 'User ID kosong!' };
  if (!pin || pin.length < 4) return { status: 'error', message: 'PIN minimal 4 karakter!' };
  const { error } = await sb.from('guru').update({ pin }).eq('nip', userId);
  if (error) return { status: 'error', message: error.message };
  return { status: 'success', message: 'PIN berhasil disimpan.' };
}

// ============================================================
// HANDLER: AUTO ABSEN (dijalankan manual)
// ============================================================
async function handleProcessAutoAbsen() {
  const today = _todayStr();
  const now = new Date();
  const curMin = now.getHours()*60 + now.getMinutes();
  const sesiList = await _getSesiList();
  if (!sesiList.length) return { status: 'success', message: 'Tidak ada sesi.' };

  const { data: libur } = await sb.from('hari_libur').select('*').eq('tanggal', today).maybeSingle();
  if (libur) return { status: 'success', message: 'Hari libur, tidak perlu proses.' };

  const lewat = sesiList.filter(s => curMin > s.tutupMin);
  if (!lewat.length) return { status: 'success', message: 'Belum ada sesi yang selesai.' };

  const { data: gRows } = await sb.from('guru').select('*');
  const { data: sRows } = await sb.from('siswa').select('*');
  const { data: existing } = await sb.from('kehadiran').select('id_user, sesi').eq('tanggal', today);
  const existingSet = new Set((existing || []).map(r => `${r.id_user}_${String(r.sesi).split(' - ')[0]}`));

  const rows = [];
  [['GURU', gRows, 'nip'], ['SISWA', sRows, 'nisn']].forEach(([peran, list, key]) => {
    (list || []).forEach(u => {
      const id = u[key];
      lewat.forEach(s => {
        if (!existingSet.has(`${id}_${s.sesi}`)) {
          const status = s.alpaSetting === 'Bolos' ? 'Bolos' : 'Alpa';
          rows.push({
            timestamp: _nowStr(), peran, id_user: id, nama_user: u.nama,
            sesi: `${s.sesi} - ${status} (Otomatis)`, tanggal: today
          });
          existingSet.add(`${id}_${s.sesi}`);
        }
      });
    });
  });
  if (rows.length) await sb.from('kehadiran').insert(rows);
  return { status: 'success', message: `Auto absen selesai. ${rows.length} baris baru.` };
}

console.log('✅ supabase-api.js loaded. sendRequest di-override.');
