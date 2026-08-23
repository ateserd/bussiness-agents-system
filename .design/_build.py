import pathlib, json

CSS = """
    @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
    :root{
      --bg:#0a0f1e; --surface:#0e1526; --surface-2:#131c30;
      --line:#1e293f; --line-hi:#2c3a58;
      --ink:#e9eef6; --ink-2:#97a6bd; --ink-3:#5f6f88;
      --accent:#f5c451; --accent-soft:rgba(245,196,81,.12);
      --ok:#3ddc84; --warn:#e8833a; --crit:#ff5b73;
      --s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:24px; --s6:32px;
      --r1:6px; --r2:10px; --r3:999px;
      --shadow:0 1px 2px rgba(0,0,0,.45), 0 12px 28px -18px rgba(0,0,0,.85);
      --sans:'Archivo',system-ui,-apple-system,'Segoe UI',sans-serif;
      --mono:'IBM Plex Mono',ui-monospace,Menlo,monospace;
    }
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);
         font-size:14px;line-height:1.55;-webkit-font-smoothing:antialiased}
    a{color:var(--accent);text-decoration:none} a:hover{color:#ffd97a}
    /* mono is for numbers, ids and timestamps only */
    .n{font-family:var(--mono);font-variant-numeric:tabular-nums;letter-spacing:-0.01em}
    /* section labels: Archivo, sentence case, no 0.2em uppercase tracking */
    .label{font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--ink-3);margin:0}
    .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r2);
          box-shadow:var(--shadow)}
    .chip{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:var(--r3);
          font-size:11px;font-weight:500;border:1px solid var(--line-hi);color:var(--ink-2)}
    .dot{width:6px;height:6px;border-radius:50%;flex:none}
    .rule{height:1px;background:var(--line);border:0;margin:0}
    /* the only motion in the whole panel: a task that is actually running */
    @keyframes live{0%,100%{opacity:1}50%{opacity:.35}}
    .running{animation:live 1.8s ease-in-out infinite}
    @media (prefers-reduced-motion:reduce){.running{animation:none}}
"""

def shell(body, css_extra=""):
    return f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>{CSS}{css_extra}</style>
</helmet>
{body}
</x-dc>
</body>
</html>
"""

def icon(path, size=16, color="currentColor", sw=1.6):
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" '
            f'stroke="{color}" stroke-width="{sw}" stroke-linecap="round" '
            f'stroke-linejoin="round" style="flex:none">{path}</svg>')

I_CAL   = '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/>'
I_MAIL  = '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'
I_PHONE = '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/>'
I_ASK   = '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.2 2.4c-.6.2-.7.7-.7 1.3M12 16.5h.01"/>'
I_WARN  = '<path d="M12 4 3 19h18L12 4Z"/><path d="M12 10v4M12 17h.01"/>'
I_BOLT  = '<path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z"/>'
I_ARROW = '<path d="M5 12h14M13 6l6 6-6 6"/>'

def nav(active):
    out = []
    for name in ["Bugün","Hat","Para","Hafıza"]:
        on = name == active
        style = (f"background:var(--accent);color:#0a0f1e;border-color:var(--accent);font-weight:600"
                 if on else "color:var(--ink-3);border-color:var(--line)")
        out.append(f'<span style="padding:5px 14px;border:1px solid;border-radius:var(--r3);'
                   f'font-size:12.5px;{style}">{name}</span>')
    return ('<nav style="display:flex;gap:var(--s2)">' + "".join(out) + '</nav>')

def header(active, sub):
    return f"""<header style="display:flex;align-items:flex-start;justify-content:space-between;gap:var(--s6);
     padding:var(--s6) 0 var(--s5)">
  <div>
    <h1 style="margin:0;font-size:19px;font-weight:700;letter-spacing:.02em">Mission
      <span style="color:var(--accent)">Control</span></h1>
    <p style="margin:6px 0 0;font-size:13px;color:var(--ink-3)">{sub}</p>
  </div>
  {nav(active)}
</header>"""

pathlib.Path("_lib.py").write_text("")
globals()["shell"]=shell

# ---------------------------------------------------------------- BUGÜN ----

def stat(label, value, sub, tone=None):
    color = {"crit":"var(--crit)","warn":"var(--warn)","ok":"var(--ok)"}.get(tone,"var(--ink)")
    return f"""<div class="card" style="padding:var(--s4) var(--s5)">
  <p class="label">{label}</p>
  <p class="n" style="margin:6px 0 2px;font-size:30px;font-weight:500;line-height:1;color:{color}">{value}</p>
  <p style="margin:0;font-size:12.5px;color:var(--ink-3)">{sub}</p>
</div>"""

def row(left, right="", pad="var(--s3) var(--s5)", border=True):
    b = "border-top:1px solid var(--line);" if border else ""
    return (f'<div style="display:flex;align-items:center;justify-content:space-between;gap:var(--s4);'
            f'padding:{pad};{b}">{left}{right}</div>')

def cardhead(title, right=""):
    return (f'<div style="display:flex;align-items:center;justify-content:space-between;'
            f'padding:var(--s4) var(--s5) var(--s3)">'
            f'<p class="label">{title}</p>{right}</div>')

NEEDS = [
    ("crit", I_ASK,  "Sana soruldu", "Marina Cafe'ye hangi fiyatı yazayım? Sitesi yok, 40 yorumu var.",
     "Outreach · <span class=\"n\">#a4f2c1</span> · <span class=\"n\">14 sa</span> önce"),
    ("accent", I_MAIL, "Günün listesi bekliyor", "3 taslak onayını bekliyor — “gönder”, “2 hariç” ya da “iptal”.",
     "Telegram'da · <span class=\"n\">09:00</span>"),
    ("warn", I_WARN, "Teslim tarihi geçti", "Kumsal site yenileme · 2 gün geçti, risk işaretli.",
     "web · build"),
]

def needs_row(tone, ic, title, body, meta, first=False):
    c = {"crit":"var(--crit)","warn":"var(--warn)","accent":"var(--accent)"}[tone]
    b = "" if first else "border-top:1px solid var(--line);"
    return f"""<div style="display:flex;gap:var(--s3);padding:var(--s4) var(--s5);{b}">
  <span style="width:2px;border-radius:2px;background:{c};flex:none;align-self:stretch"></span>
  <span style="color:{c};margin-top:2px">{icon(ic,17,c)}</span>
  <div style="min-width:0">
    <p style="margin:0;font-size:13.5px;font-weight:600">{title}</p>
    <p style="margin:2px 0 0;font-size:13.5px;color:var(--ink-2)">{body}</p>
    <p style="margin:5px 0 0;font-size:11.5px;color:var(--ink-3)">{meta}</p>
  </div>
</div>"""

MEETINGS = [("14:00","Kumsal Balık — tanışma","meet.google.com/xrt-kfqd-abc"),
            ("17:30","Deniz Lojistik — akış devir","meet.google.com/vpm-doaz-xyz")]

ACTS = [("Outreach","Taslak onaya gönderildi — Marina Cafe","ok","4 dk"),
        ("Ops","Toplantı oluşturuldu — Kumsal Balık 14:00","ok","22 dk"),
        ("Scout","İzmir · kuaför — 12 lead eklendi, 31 elendi","ok","1 sa"),
        ("Outreach","Gönderildi — Ege Yapı Market","ok","2 sa"),
        ("Yönetici","Günlük mail sayısı 10 → 7 (bugüne özel)","ok","3 sa"),
        ("Ops","Kur okunamadı — TCMB yanıt vermedi","warn","5 sa")]

def act_row(who, what, tone, when, first=False):
    c = {"ok":"var(--ok)","warn":"var(--warn)","crit":"var(--crit)"}[tone]
    b = "" if first else "border-top:1px solid var(--line);"
    return f"""<div style="display:flex;gap:var(--s3);align-items:flex-start;padding:11px var(--s5);{b}">
  <span class="dot" style="background:{c};margin-top:7px"></span>
  <div style="flex:1;min-width:0">
    <p style="margin:0;font-size:13px;color:var(--ink)">{what}</p>
    <p style="margin:2px 0 0;font-size:11.5px;color:var(--ink-3)">{who}</p>
  </div>
  <span class="n" style="font-size:11.5px;color:var(--ink-3);white-space:nowrap">{when}</span>
</div>"""

def bugun_body(mobile=False):
    pad = "var(--s4)" if mobile else "56px"
    brief = f"""<div style="display:flex;gap:var(--s4);padding:var(--s5);border-left:2px solid var(--accent);
     background:var(--accent-soft);border-radius:0 var(--r2) var(--r2) 0;margin-bottom:var(--s5)">
  <div>
    <p class="label" style="color:var(--accent)">Yönetici</p>
    <p style="margin:6px 0 0;font-size:{'14.5px' if not mobile else '14px'};line-height:1.6;max-width:74ch">
      Bugün tek gerçek iş Marina Cafe: fiyat sorusu 14 saattir bekliyor ve teklif
      22 gündür kıpırdamadı — cevap verirsen taslak bugün çıkar.
      Kumsal'ın teslimi 2 gün geçmiş, müşteriye bir haber gitmesi lazım.
      Diğer her şey yolunda.</p>
  </div>
</div>"""
    stats = "".join([
        stat("Çalışan görev","2","Scout · Outreach"),
        stat("Sana takılı","1","en eskisi 14 sa","crit"),
        stat("Onay bekleyen","3","günün listesi","warn"),
        stat("Bugün giden","7","10 kotadan"),
    ])
    stats = (f'<div style="display:grid;grid-template-columns:repeat({2 if mobile else 4},minmax(0,1fr));'
             f'gap:var(--s4);margin-bottom:var(--s5)">{stats}</div>')

    needs = "".join(needs_row(*n, first=(i==0)) for i,n in enumerate(NEEDS))
    needs_card = f'<div class="card">{cardhead("Sana düşenler")}<hr class="rule">{needs}</div>'

    mt = "".join(
        row(f'<div style="display:flex;gap:var(--s3);align-items:center;min-width:0">'
            f'<span class="n" style="font-size:13.5px;color:var(--accent)">{t}</span>'
            f'<div style="min-width:0"><p style="margin:0;font-size:13.5px">{title}</p>'
            f'<p style="margin:1px 0 0;font-size:11.5px;color:var(--ink-3)" class="n">{link}</p></div></div>',
            f'<span style="color:var(--ink-3)">{icon(I_CAL,15,"var(--ink-3)")}</span>')
        for t,title,link in MEETINGS)
    batch = row(
        f'<div style="display:flex;gap:var(--s3);align-items:center">'
        f'<span style="color:var(--ink-3)">{icon(I_MAIL,15,"var(--ink-3)")}</span>'
        f'<div><p style="margin:0;font-size:13.5px">Günün listesi — <span class="n">7</span> mail · '
        f'<span class="n">5</span> arama</p>'
        f'<p style="margin:1px 0 0;font-size:11.5px;color:var(--ink-3)">'
        f'Telegram\'a <span class="n">09:00</span>\'da gitti · <span class="n">3</span> hâlâ açık</p></div></div>',
        f'<span class="chip" style="border-color:rgba(232,131,58,.4);color:var(--warn)">bekliyor</span>')
    today_card = (f'<div class="card">{cardhead("Bugün")}<hr class="rule">{mt}{batch}</div>')

    running = "".join([
        row(f'<div style="display:flex;gap:var(--s3);align-items:center">'
            f'<span class="dot running" style="background:var(--ok)"></span>'
            f'<div><p style="margin:0;font-size:13.5px">Sektör araştırması — kuaför, İzmir</p>'
            f'<p style="margin:1px 0 0;font-size:11.5px;color:var(--ink-3)">Scout · '
            f'<span class="n">#7f21c0</span></p></div></div>',
            '<span class="n" style="font-size:11.5px;color:var(--ink-3)">1dk 12sn</span>', border=False),
        row(f'<div style="display:flex;gap:var(--s3);align-items:center">'
            f'<span class="dot running" style="background:var(--ok)"></span>'
            f'<div><p style="margin:0;font-size:13.5px">Cold mail taslakları — 4 lead</p>'
            f'<p style="margin:1px 0 0;font-size:11.5px;color:var(--ink-3)">Outreach · '
            f'<span class="n">#c40e9a</span></p></div></div>',
            '<span class="n" style="font-size:11.5px;color:var(--ink-3)">38sn</span>'),
    ])
    live_chip = ('<span class="chip" style="border-color:rgba(61,220,132,.35);color:var(--ok)">'
                 '<span class="dot running" style="background:var(--ok)"></span>canlı</span>')
    running_card = (f'<div class="card">{cardhead("Şu an çalışıyor", live_chip)}'
                    f'<hr class="rule">{running}</div>')

    acts = "".join(act_row(*a, first=(i==0)) for i,a in enumerate(ACTS))
    acts_card = f'<div class="card">{cardhead("Son hareketler")}<hr class="rule">{acts}</div>'

    if mobile:
        stack = "".join(f'<div style="margin-bottom:var(--s4)">{c}</div>'
                        for c in [needs_card, today_card, running_card, acts_card])
        return (f'<div style="padding:0 {pad} var(--s6)">{brief}{stats}{stack}</div>')

    cols = (f'<div style="display:grid;grid-template-columns:minmax(0,1.62fr) minmax(0,1fr);gap:var(--s5)">'
            f'<div style="display:flex;flex-direction:column;gap:var(--s5)">{needs_card}{today_card}{running_card}</div>'
            f'<div>{acts_card}</div></div>')
    return f'<div style="padding:0 {pad} 56px">{brief}{stats}{cols}</div>'

sub = 'Ateş Erdem Akköse · <span class="n">23 Ağustos</span> Pazar'
pathlib.Path("Main.dc.html").write_text(shell(
    f'<div style="padding:0 56px"><div style="max-width:1328px;margin:0 auto">{header("Bugün", sub)}</div></div>'
    f'<div style="max-width:1440px;margin:0 auto">{bugun_body()}</div>'))

mob_header = f"""<header style="padding:var(--s5) var(--s4) var(--s4)">
  <h1 style="margin:0;font-size:17px;font-weight:700">Mission <span style="color:var(--accent)">Control</span></h1>
  <p style="margin:5px 0 var(--s4);font-size:12.5px;color:var(--ink-3)">{sub}</p>
  <div style="display:flex;gap:6px;overflow:hidden">{nav("Bugün").split(chr(62),1)[1][:-6]}</div>
</header>"""
pathlib.Path("BugunMobil.dc.html").write_text(shell(mob_header + bugun_body(mobile=True)))
print("bugun ok")

# ------------------------------------------------------------------ HAT ----

def branch_chip(b):
    c = {"web":"var(--accent)","flow":"#7fb8d8"}[b]
    return (f'<span class="chip" style="border-color:{c}33;color:{c};padding:1px 7px;font-size:10.5px">{b}</span>')

STAGES = [
    ("Lead", "24", "havuzda", [("Ege Yapı Market","web","sitesi yok · 62 yorum"),
                               ("Bornova Kuaför","web","sitesi yok · 41 yorum"),
                               ("Uçar Nakliyat","flow","site var · 88 yorum"),
                               ("Kahve Durağı","web","sitesi yok · 30 yorum")]),
    ("Fırsat", "2", "$11.500", [("Marina Cafe sitesi","web","proposal · $2.500 · 22 gün"),
                                ("Toptancı entegrasyonu","flow","discovery · $9.000 · 2 gün")]),
    ("Proje", "3", "1 riskte", [("Kumsal site yenileme","web","build · 2 gün geçti"),
                                ("Deniz landing","web","design · 5 gün kaldı"),
                                ("Sipariş akışı","flow","live · akış hatalı")]),
    ("Müşteri", "3", "$1.300/ay", [("Deniz Lojistik","flow","$900/ay · 3 gün önce"),
                                   ("Kumsal Balık","web","$400/ay · 41 gün sessiz"),
                                   ("Ege Kuaför","web","$0/ay · hiç temas yok")]),
]

def funnel_bar(mobile=False):
    cells = []
    for i,(name,count,note,_) in enumerate(STAGES):
        cells.append(f"""<div class="card" style="padding:var(--s4) var(--s5);flex:1;min-width:0">
  <p class="label">{name}</p>
  <p class="n" style="margin:6px 0 2px;font-size:32px;font-weight:500;line-height:1">{count}</p>
  <p style="margin:0;font-size:12.5px;color:var(--ink-3)">{note}</p>
</div>""")
        if i < len(STAGES)-1:
            cells.append(f'<div style="display:flex;align-items:center;color:var(--ink-3);flex:none">'
                         f'{icon(I_ARROW,18,"var(--line-hi)")}</div>')
    d = "column" if mobile else "row"
    return (f'<div style="display:flex;flex-direction:{d};gap:var(--s3);align-items:stretch;'
            f'margin-bottom:var(--s5)">' + "".join(cells) + '</div>')

def stage_col(name, rows, tone=None):
    body = []
    for i,(title,br,meta) in enumerate(rows):
        b = "" if i==0 else "border-top:1px solid var(--line);"
        body.append(f"""<div style="padding:var(--s3) var(--s5);{b}">
  <div style="display:flex;align-items:center;gap:var(--s2);justify-content:space-between">
    <p style="margin:0;font-size:13.5px;font-weight:500;min-width:0;overflow:hidden;
       text-overflow:ellipsis;white-space:nowrap">{title}</p>{branch_chip(br)}
  </div>
  <p style="margin:2px 0 0;font-size:11.5px;color:var(--ink-3)" class="n">{meta}</p>
</div>""")
    more = ('<div style="padding:var(--s3) var(--s5);border-top:1px solid var(--line);'
            'font-size:12px;color:var(--ink-3)">+20 tane daha</div>' if name=="Lead" else "")
    return f'<div class="card">{cardhead(name)}<hr class="rule">{"".join(body)}{more}</div>'

def hat_body(mobile=False):
    pad = "var(--s4)" if mobile else "56px"
    cols = "".join(stage_col(n, rows) for n,_,_,rows in STAGES)
    grid = (f'<div style="display:grid;grid-template-columns:repeat({1 if mobile else 4},minmax(0,1fr));'
            f'gap:var(--s4)">{cols}</div>')
    note = ('<p style="margin:var(--s5) 0 0;font-size:12.5px;color:var(--ink-3)">'
            'Dokunulmamış lead 30 gün sonra siliniyor · temas kurulan kalıyor</p>')
    return f'<div style="padding:0 {pad} 56px">{funnel_bar(mobile)}{grid}{note}</div>'

pathlib.Path("Hat.dc.html").write_text(shell(
    f'<div style="padding:0 56px"><div style="max-width:1328px;margin:0 auto">'
    f'{header("Hat", "Lead → fırsat → proje → müşteri · iki şube")}</div></div>'
    f'<div style="max-width:1440px;margin:0 auto">{hat_body()}</div>'))

mob_h2 = f"""<header style="padding:var(--s5) var(--s4) var(--s4)">
  <h1 style="margin:0;font-size:17px;font-weight:700">Mission <span style="color:var(--accent)">Control</span></h1>
  <p style="margin:5px 0 var(--s4);font-size:12.5px;color:var(--ink-3)">Lead → fırsat → proje → müşteri</p>
  <div style="display:flex;gap:6px;overflow:hidden">{nav("Hat").split(chr(62),1)[1][:-6]}</div>
</header>"""
pathlib.Path("HatMobil.dc.html").write_text(shell(mob_h2 + hat_body(mobile=True)))
print("hat ok")

# ----------------------------------------------------------------- PARA ----

def money_row(label, value, tone=None, strong=False, first=False):
    c = {"ok":"var(--ok)","warn":"var(--warn)","crit":"var(--crit)"}.get(tone,"var(--ink)")
    b = "" if first else "border-top:1px solid var(--line);"
    w = "600" if strong else "400"
    return (f'<div style="display:flex;justify-content:space-between;align-items:baseline;'
            f'padding:10px var(--s5);{b}">'
            f'<span style="font-size:13.5px;color:var(--ink-2)">{label}</span>'
            f'<span class="n" style="font-size:14.5px;font-weight:{w};color:{c}">{value}</span></div>')

def branch_card(name, tag, rows, net, net_tone):
    body = "".join(money_row(*r, first=(i==0)) for i,r in enumerate(rows))
    return f"""<div class="card">
  <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--s4) var(--s5) var(--s3)">
    <div><p style="margin:0;font-size:15px;font-weight:600">{name}</p>
      <p class="label" style="margin-top:2px">{tag}</p></div>
  </div>
  <hr class="rule">{body}
  <div style="display:flex;justify-content:space-between;align-items:baseline;padding:var(--s4) var(--s5);
       border-top:1px solid var(--line-hi);background:var(--surface-2);
       border-radius:0 0 var(--r2) var(--r2)">
    <span style="font-size:13.5px;font-weight:600">Net</span>
    <span class="n" style="font-size:20px;font-weight:600;color:{net_tone}">{net}</span>
  </div>
</div>"""

WEEKS = [("28.6",1200,0),("5.7",0,2400),("12.7",800,0),("19.7",0,0),("26.7",2100,900),
         ("2.8",0,2400),("9.8",1500,0),("16.8",600,900),("23.8",0,2400),("30.8",2500,0),
         ("6.9",0,900),("13.9",1800,2400)]

def trend():
    W,H,PAD = 1256, 168, 26
    mx = max(w+a for _,w,a in WEEKS) or 1
    n = len(WEEKS)
    bw = (W - PAD*2) / n
    bars, labels, grid = [], [], []
    for gy in (0, .5, 1):
        y = PAD + (H - PAD*2) * gy
        grid.append(f'<line x1="{PAD}" y1="{y:.0f}" x2="{W-PAD}" y2="{y:.0f}" stroke="#1e293f" stroke-width="1"/>')
    for i,(wk,web,auto) in enumerate(WEEKS):
        x = PAD + i*bw + bw*0.24
        w_ = bw*0.52
        total = H - PAD*2
        hw = (web/mx)*total
        ha = (auto/mx)*total
        y0 = H - PAD
        if hw: bars.append(f'<rect x="{x:.0f}" y="{y0-hw:.0f}" width="{w_:.0f}" height="{hw:.0f}" rx="2" fill="#f5c451"/>')
        if ha: bars.append(f'<rect x="{x:.0f}" y="{y0-hw-ha:.0f}" width="{w_:.0f}" height="{ha:.0f}" rx="2" fill="#7fb8d8"/>')
        labels.append(f'<text x="{x + w_/2:.0f}" y="{H-8}" fill="#5f6f88" font-size="10" '
                      f'font-family="IBM Plex Mono, monospace" text-anchor="middle">{wk}</text>')
    return (f'<svg viewBox="0 0 {W} {H}" width="100%" height="{H}" style="display:block">'
            + "".join(grid+bars+labels) + '</svg>')

COSTS = [("Yönetici","$0,84","claude-sonnet-5","62%"),
         ("Scout","$0,31","claude-sonnet-5","23%"),
         ("Outreach","$0,15","claude-sonnet-5","11%"),
         ("Ops","$0,05","claude-haiku-4-5","4%")]

def cost_rows():
    out=[]
    for i,(who,amt,model,share) in enumerate(COSTS):
        b = "" if i==0 else "border-top:1px solid var(--line);"
        out.append(f"""<div style="display:flex;align-items:center;gap:var(--s4);padding:10px var(--s5);{b}">
  <span style="font-size:13.5px;width:96px;flex:none">{who}</span>
  <span class="n" style="font-size:11.5px;color:var(--ink-3);width:150px;flex:none">{model}</span>
  <span style="flex:1;height:5px;border-radius:3px;background:var(--surface-2);overflow:hidden">
    <span style="display:block;height:100%;width:{share};background:var(--accent);opacity:.8"></span></span>
  <span class="n" style="font-size:13.5px;width:56px;text-align:right;flex:none">{amt}</span>
</div>""")
    return "".join(out)

def para_body():
    web = branch_card("Ateş Design Agency","web şubesi", [
        ("Bu ay gelir","$4.200"), ("Tahsil edilen","$2.800","ok"),
        ("Ödenmemiş","$1.400 · 2 fatura","warn"), ("Gider","$310"),
        ("Ajan maliyeti","$0,68")], "$3.222", "var(--ok)")
    flow = branch_card("Ateş Flow Agency","otomasyon şubesi", [
        ("Bu ay gelir","$6.600"), ("Tahsil edilen","$6.600","ok"),
        ("Ödenmemiş","$0"), ("Gider","$540"),
        ("Ajan maliyeti","$0,67")], "$6.059", "var(--ok)")
    legend = ('<div style="display:flex;gap:var(--s4);align-items:center">'
              '<span class="chip" style="border-color:#f5c45133;color:var(--accent)">'
              '<span class="dot" style="background:var(--accent)"></span>web</span>'
              '<span class="chip" style="border-color:#7fb8d833;color:#7fb8d8">'
              '<span class="dot" style="background:#7fb8d8"></span>flow</span></div>')
    chart = (f'<div class="card" style="margin-top:var(--s5)">'
             f'{cardhead("12 haftalık tahsilat", legend)}<hr class="rule">'
             f'<div style="padding:var(--s4) var(--s3) var(--s2)">{trend()}</div></div>')
    total_chip = '<span class="n" style="font-size:13.5px">$1,35</span>'
    costs = (f'<div class="card" style="margin-top:var(--s5)">'
             f'{cardhead("Ajan maliyeti — bu ay", total_chip)}'
             f'<hr class="rule">{cost_rows()}</div>')
    return (f'<div style="padding:0 56px 56px">'
            f'<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s5)">{web}{flow}</div>'
            f'{chart}{costs}</div>')

para_sub = "İki şubenin P&amp;L tablosu · <span class=\"n\">Ağustos</span>"
para_head = header("Para", para_sub)
pathlib.Path("Para.dc.html").write_text(shell(
    f'<div style="padding:0 56px"><div style="max-width:1328px;margin:0 auto">{para_head}</div></div>'
    f'<div style="max-width:1440px;margin:0 auto">{para_body()}</div>'))
print("para ok")

# --------------------------------------------------------------- HAFIZA ----

import math, random
random.seed(7)

def constellation():
    W,H = 780, 560
    groups = [("global", 390, 250, "#f5c451", 11),
              ("web",    195, 380, "#e0b04a", 9),
              ("flow",   585, 375, "#7fb8d8", 8),
              ("müşteri",390, 105, "#8f9bb3", 3)]
    nodes, links = [], []
    pts = {}
    for gi,(name,cx,cy,color,count) in enumerate(groups):
        for i in range(count):
            a = (i/count)*math.tau + gi*0.7
            r = 46 + (i % 3)*23 + random.random()*14
            x, y = cx + math.cos(a)*r*1.35, cy + math.sin(a)*r
            permanent = (i % 3 == 0)
            rad = 6.5 if permanent else 4.2
            pts[(gi,i)] = (x,y,color)
            op = "1" if permanent else ".62"
            ring = (f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{rad+3.5:.0f}" fill="none" '
                    f'stroke="{color}" stroke-opacity=".22" stroke-width="1"/>') if permanent else ""
            nodes.append(f'{ring}<circle cx="{x:.0f}" cy="{y:.0f}" r="{rad}" fill="{color}" fill-opacity="{op}"/>')
    keys = list(pts)
    for _ in range(15):
        a,b = random.sample(keys, 2)
        x1,y1,c1 = pts[a]; x2,y2,_ = pts[b]
        if abs(x1-x2) + abs(y1-y2) > 420: continue
        links.append(f'<line x1="{x1:.0f}" y1="{y1:.0f}" x2="{x2:.0f}" y2="{y2:.0f}" '
                     f'stroke="{c1}" stroke-opacity=".16" stroke-width="1"/>')
    labels = "".join(
        f'<text x="{cx}" y="{cy - (78 if name!="müşteri" else 52)}" fill="{color}" fill-opacity=".7" '
        f'font-size="11" font-weight="600" font-family="Archivo, sans-serif" '
        f'text-anchor="middle">{name}</text>' for name,cx,cy,color,_ in groups)
    return (f'<svg viewBox="0 0 {W} {H}" width="100%" height="{H}" style="display:block">'
            + "".join(links) + "".join(nodes) + labels + '</svg>')

MEMS = [("kalıcı gerçek","Sahip tek insan; hiçbir ajan başka bir insana iş devredemez.","global"),
        ("kalıcı gerçek","Saat dilimi Europe/Istanbul. Sabah brifingi 07:30.","global"),
        ("karar","Cold mail yalnızca toplu onaydan sonra çıkar.","global"),
        ("kalıcı gerçek","Web ICP: sitesi olmayan, en az 1 yorumu olan işletme.","web"),
        ("ders","İzmir kuaför segmentinde telefon dönüş oranı maile göre 3 kat.","web")]

def mem_rows():
    out = []
    for i,(kind,text,scope) in enumerate(MEMS):
        b = "" if i==0 else "border-top:1px solid var(--line);"
        c = "var(--accent)" if scope!="flow" else "#7fb8d8"
        perm = kind == "kalıcı gerçek"
        out.append(f"""<div style="padding:var(--s3) var(--s5);{b}">
  <div style="display:flex;align-items:center;gap:var(--s2);margin-bottom:3px">
    <span class="chip" style="border-color:{c}33;color:{c};padding:1px 7px;font-size:10.5px">{scope}</span>
    <span style="font-size:11px;color:var(--ink-3)">{kind}</span>
    {'<span style="margin-left:auto;color:var(--ink-3)">'+icon('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',13,"var(--ink-3)")+'</span>' if perm else ''}
  </div>
  <p style="margin:0;font-size:13.5px;color:var(--ink-2)">{text}</p>
</div>""")
    return "".join(out)

def hafiza_body():
    canvas = (f'<div class="card" style="padding:var(--s4);overflow:hidden">{constellation()}</div>')
    counts = "".join(
        f'<div style="flex:1"><p class="n" style="margin:0;font-size:22px;font-weight:500">{v}</p>'
        f'<p class="label" style="margin-top:2px">{k}</p></div>'
        for k, v in [("anı", "31"), ("kalıcı gerçek", "21"), ("bağ", "15")])
    side = f"""<div style="display:flex;flex-direction:column;gap:var(--s5)">
  <div class="card" style="padding:var(--s4) var(--s5)">
    <div style="display:flex;gap:var(--s4)">{counts}</div>
  </div>
  <div class="card">{cardhead("Seçili küme — global")}<hr class="rule">{mem_rows()}</div>
  <div class="card" style="padding:var(--s4) var(--s5)">
    <p class="label">Not ekle</p>
    <div style="margin-top:var(--s3);border:1px solid var(--line-hi);border-radius:var(--r1);
         padding:10px var(--s3);color:var(--ink-3);font-size:13.5px;min-height:64px">
      Bu kümeye kalıcı bir bilgi yaz…</div>
    <p style="margin:var(--s3) 0 0;font-size:11.5px;color:var(--ink-3)">
      Hafızayı sen düzenlersin — ajanlara komut vermek Telegram'dan.</p>
  </div>
</div>"""
    return (f'<div style="padding:0 56px 56px">'
            f'<div style="display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:var(--s5)">'
            f'{canvas}{side}</div></div>')

haf_head = header("Hafıza", "Ajanların ortak beyni · kapsam yalıtımıyla")
pathlib.Path("Hafiza.dc.html").write_text(shell(
    f'<div style="padding:0 56px"><div style="max-width:1328px;margin:0 auto">{haf_head}</div></div>'
    f'<div style="max-width:1440px;margin:0 auto">{hafiza_body()}</div>'))

canvas = {
  "artboards": [
    {"file":"Main.dc.html",       "x":0,     "y":0,    "w":1440, "h":1140, "title":"Bugün"},
    {"file":"Hat.dc.html",        "x":1560,  "y":0,    "w":1440, "h":960,  "title":"Hat"},
    {"file":"BugunMobil.dc.html", "x":3120,  "y":0,    "w":390,  "h":1180, "title":"Bugün · mobil"},
    {"file":"HatMobil.dc.html",   "x":3630,  "y":0,    "w":390,  "h":1180, "title":"Hat · mobil"},
    {"file":"Para.dc.html",       "x":0,     "y":1320, "w":1440, "h":900,  "title":"Para"},
    {"file":"Hafiza.dc.html",     "x":1560,  "y":1320, "w":1440, "h":880,  "title":"Hafıza"}
  ],
  "annotations": [
    {"id":"n-kes","x":0,"y":-190,"w":420,
     "text":"KESİLENLER\nYıldız alanı · altın radyal parlama · üç ölü animasyon\n(mc-breathe, mc-breathe-red, mc-ring-gold) · altı neon\naksandan beşi. \"Üretilmiş\" hissi veren işaretler bunlardı."},
    {"id":"n-tut","x":460,"y":-190,"w":420,
     "text":"TUTULANLAR\nKoyu zemin + altın: kimlik, slop değil.\nArchivo + IBM Plex Mono.\nTek aksan altın; ok/uyarı/kritik ondan ayrı."},
    {"id":"n-tip","x":920,"y":-190,"w":460,
     "text":"TİPOGRAFİ DÜZELTİLDİ\nEskiden .mc-eyebrow (10.5px mono, BÜYÜK HARF, 0.2em\naralık) 32 yerde, çoğu düz etiketti. Artık mono yalnızca\nsayı, id ve zaman damgasında. Etiketler Archivo, normal düzen."},
    {"id":"n-hareket","x":1560,"y":-190,"w":420,
     "text":"HAREKET\nTek animasyon: gerçekten çalışan bir görevin noktası.\nBaşka hiçbir şey kıpırdamıyor.\nprefers-reduced-motion'da o da duruyor."},
    {"id":"n-ayna","x":2040,"y":-190,"w":440,
     "text":"AKSİYON DÜĞMESİ YOK\nÇalıştır · Duraklat · Onayla/Reddet kalktı — panel ayna,\nkumanda Telegram'dan. Tek istisna Hafıza'daki not ekleme\nve silme: onlar hafıza düzenlemek, ajana komut değil."},
    {"id":"n-veri","x":3120,"y":-190,"w":420,
     "text":"VERİ\nYapı ve alanlar gerçek (brief.ts, getLedger, getBrain\nçıktılarından). Rakamlar örnek — düzeni değerlendirebil\ndiye dolduruldu, canlı sistemden değil."}
  ],
  "launch": {"view":"canvas"}
}
pathlib.Path("canvas.json").write_text(json.dumps(canvas, ensure_ascii=False, indent=1))
print("hafiza + canvas ok")
