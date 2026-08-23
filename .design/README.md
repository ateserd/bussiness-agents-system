# .design — tasarım tuvalinin kaynağı

`mission-control-panel.html` buradan üretiliyor ve **commit edilmiyor**: içine
tuval editörünün tamamı gömülü olduğu için 2.3 MB, ve her seferinde şu üç
şeyden yeniden üretilebiliyor — `*.dc.html` artboard'ları, `canvas.json`
yerleşimi ve `_build.py`.

Tasarımda bir şey değiştirmek, o üçünden birini değiştirip yeniden üretmek
demek. Üretilmiş dosyayı elle düzenlemek bir sonraki üretimde kaybolur.

```bash
cd .design
python3 _build.py                     # artboard'ları yeniden yaz
node "<design skill dizini>/seed-canvas.mjs" \
  --template "<design skill dizini>/payload.template.html" \
  --out mission-control-panel.html --title "Mission Control Paneli" \
  --artboard Main.dc.html --artboard Hat.dc.html --artboard Para.dc.html \
  --artboard Hafiza.dc.html --artboard BugunMobil.dc.html --artboard HatMobil.dc.html \
  --canvas canvas.json
```

Tuvaldeki rakamlar örnek. Yapı ve alan adları gerçek (`brief.ts`, `getLedger()`,
`getBrain()` çıktılarından alındı) ama sayılar düzeni değerlendirmek için
uyduruldu — canlı sistemden gelmiyor.
