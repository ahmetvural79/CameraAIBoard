# CameraAIBoard ✋➗

> **Havada parmağınızla yazın, yapay zekâ çözsün.**
> Draw math in the air with your finger — AI reads it and writes the answer back on screen.

Kameraya bakıp **parmağınızla havaya yazarsınız**; uygulama elinizi gerçek
zamanlı takip ederek çizim yapar, yazdığınız denklemi **Claude** (görüş/OCR) ile
okuyup sonucu yine tahtaya el yazısı gibi yazar. Hem aritmetik (`12 + 7 =`) hem
de **x'li denklemler** (`2x + 3 = 7`, `x² − 5x + 6 = 0`) desteklenir.

Tarayıcıda **Google MediaPipe Hand Landmarker** (21 noktalı, gerçek zamanlı el
takibi) + sunucu tarafında **Claude Opus 4.8** görüş modeli kullanılır.

---

## ✨ Özellikler

- 🖐️ **Eller serbest:** fare/klavye yok — her şey el hareketleriyle.
- ✏️ **Akıcı çizim:** One-Euro filtresi + eğri yumuşatma ile titremesiz, kesintisiz çizgiler.
- 🧽 **Silgi & temizle:** el hareketleriyle.
- 🎨 **Elle renk seçimi:** renge işaret edip kısa süre bekleyince (dwell) seçilir.
- 🤖 **Yapay zekâ ile çözüm:** denklemi tahtadan okur, cevabı denklemin yanına yazar.
- 🔢 **Aritmetik + cebir:** dört işlem, üs, parantez **ve x için denklem çözme**.
- ✅ **Düzeltme:** rakam yanlış okunduysa tanınan ifadeyi düzeltip anında yeniden hesaplatabilirsiniz.

## ✋ Hareketler

| Hareket | İşlev |
| --- | --- |
| ☝️ Tek parmak (işaret) | Seçili renkle **çizim** |
| 🖐️ Açık el | **Silgi** |
| 👍 Baş yukarı başparmak (kısa süre tut) | **Çöz** — tahtayı Claude'a gönderir |
| 👎 Baş aşağı başparmak (kısa süre tut) | Tahtayı **temizle** |
| 🎨 İşaret parmağını renk kutusunda ~0.5 sn beklet | **Renk seç** |

> Akış: denklemi yazın (örn. `2x + 3 = 7`), sonra 👍 yapın → Claude okur,
> sonucu (`x = 2`) denklemin yanına yazar.

## 🧠 Mimari

```
tarayıcı (public/)                         sunucu (server.js)
  ├─ MediaPipe HandLandmarker  ── el ─┐
  ├─ filters.js   (One-Euro)          │
  ├─ gestures.js  (hareket sınıflama) │
  ├─ canvas.js    (çizim/silgi/cevap) │
  └─ solver.js ── PNG / metin ───────►├─ POST /api/solve
                                       └─ Anthropic SDK → claude-opus-4-8 (vision)
                                          → {found, type, equation, answer}
```

- El takibi tamamen **tarayıcıda** (WebGL/WASM) çalışır; sadece **Çöz** anında
  tahtanın görüntüsü sunucuya gider.
- **API anahtarı sunucuda kalır**, tarayıcıya hiç sızmaz.
- Görüntü keskin kalsın diye el takibi ayrı küçük bir tuvalde yapılır → net
  görüntü + düşük gecikme.

## 🛠 Teknolojiler

- **El takibi:** [@mediapipe/tasks-vision](https://www.npmjs.com/package/@mediapipe/tasks-vision) (HandLandmarker)
- **Yapay zekâ:** [Anthropic Claude](https://www.anthropic.com/) (Opus 4.8, görüş)
- **Sunucu:** Node.js + Express
- **Önyüz:** derlemesiz vanilla JavaScript (ES modülleri) + Canvas API

## 🚀 Kurulum

Gereksinim: **Node.js 18+** ve bir Claude API anahtarı.

```bash
git clone https://github.com/ahmetvural79/CameraAIBoard.git
cd CameraAIBoard
npm install
cp .env.example .env        # ardından .env içine ANTHROPIC_API_KEY yazın
npm start
```

Tarayıcıdan **http://localhost:3000** adresini açın, **Kamerayı Başlat**'a basıp
kamera iznini verin. (Kamera erişimi için sayfa `localhost` üzerinden sunulur —
güvenli bağlam.)

## ⚙️ Ayarlar (`.env`)

| Değişken | Varsayılan | Açıklama |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | **Gerekli.** Claude API anahtarı |
| `CLAUDE_MODEL` | `claude-opus-4-8` | Görüş destekli herhangi bir Claude modeli |
| `PORT` | `3000` | Sunucu portu |

## 📁 Proje yapısı

```
CameraAIBoard/
├─ server.js            Express + Anthropic proxy (/api/solve)
├─ package.json
├─ .env.example
└─ public/
   ├─ index.html
   ├─ styles.css
   ├─ app.js            kamera + MediaPipe döngüsü + UI orkestrasyonu
   ├─ filters.js        One-Euro yumuşatma filtresi
   ├─ gestures.js       21 nokta → hareket sınıflandırma
   ├─ canvas.js         çizim/silgi/temizle + cevap render
   └─ solver.js         /api/solve çağrısı + yerel güvenli hesaplayıcı
```

## 💡 İpuçları

- En iyi tanıma için rakamları **iri ve net** yazın, kalın bir kalem rengi seçin.
- Çarpma için `x` / `*`, bölme için `/`, üs için `^`, parantez için `( )`.
- Çizim hâlâ titriyorsa `public/app.js` üstündeki `FILTER_OPTS`, `DRAW_GRACE` ve
  `INF_W` değerleriyle ince ayar yapabilirsiniz.

## 🔒 Güvenlik

API anahtarınız yalnızca sunucuda (`.env`) tutulur; `.env` `.gitignore`
içindedir ve tarayıcıya gönderilmez. `.env.example` dosyasına **gerçek anahtar
yazmayın** — yalnızca şablondur.

## 📄 Lisans

[MIT](LICENSE)
