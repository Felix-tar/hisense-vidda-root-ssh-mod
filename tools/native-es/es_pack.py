#!/usr/bin/env python3
"""es_pack.py — packt Video-/Tonpakete samt PTS in eine .flxp-Datei fuer flex_es_probe.

Laeuft auf der Build-VM. Eingang: Matroska mit H.264 (oder HEVC) und optional E-AC-3/AC-3.
Die Pakete kommen per `ffmpeg -c copy` (Video mit *_mp4toannexb), die PTS/Groessen aus
`-f framecrc` desselben Laufs; die Summe der Groessen wird gegen die Rohdatei geprueft.

  python3 es_pack.py <in.mkv> <out.flxp> [--ffmpeg /usr/bin/ffmpeg]

Format: Kopf "FLXP" + 7 x u32 (version, fps_num, fps_den, vcodec, acodec, width, height),
dann je Paket u32 type (0 Ton, 1 Video), u32 size, u64 pts_us, Daten. Reihenfolge = DTS.
"""
import argparse
import heapq
import os
import shutil
import re
import struct
import subprocess
import tempfile
from fractions import Fraction

# Werte fuer ST_MEDIA_INFO: H.264/HEVC/VP9 und Ton aus libstplayer::createMedia + Enum-Namen,
# VC-1/MPEG-2/MPEG-4 am TV ermittelt (tools/es_codecprobe.sh, Kernel-Log), §7e/§7g.
VCODEC = {"h264": 7, "hevc": 0x14, "vp9": 0x15, "vc1": 12, "mpeg2video": 1, "mpeg4": 2}
VBSF = {"h264": "h264_mp4toannexb", "hevc": "hevc_mp4toannexb"}
ACODEC = {"eac3": 5, "ac3": 5, "aac": 6}
INT64_MIN = -(1 << 63)  # framecrc: kein Zeitstempel


def probe(ffprobe, ffmpeg, src, sel, entries):
    if not os.path.exists(ffprobe) and not os.path.exists(ffprobe + ".exe"):
        return probe_with_ffmpeg(ffmpeg, src, sel)
    out = subprocess.run([ffprobe, "-v", "error", "-select_streams", sel, "-show_entries",
                          "stream=" + entries, "-of", "default=nw=1", src],
                         check=True, capture_output=True, text=True).stdout
    return dict(line.split("=", 1) for line in out.splitlines() if "=" in line)


def probe_with_ffmpeg(ffmpeg, src, sel):
    """Ersatz, wenn es kein ffprobe gibt (z. B. imageio-ffmpeg am PC): ffmpeg -i auswerten."""
    err = subprocess.run([ffmpeg, "-hide_banner", "-i", src], capture_output=True, text=True).stderr
    kind = "Video" if sel.startswith("v") else "Audio"
    m = re.search(rf"Stream #0:\d+.*?: {kind}: (\w+)(.*)", err)
    if not m:
        return {}
    info = {"codec_name": m.group(1)}
    if kind == "Video":
        size = re.search(r"(\d{3,5})x(\d{3,5})", m.group(2))
        fps = re.search(r"([\d.]+) fps", m.group(2)).group(1)
        rate = {"23.98": "24000/1001", "29.97": "30000/1001", "59.94": "60000/1001"}.get(fps, f"{fps}/1")
        info.update(width=size.group(1), height=size.group(2), r_frame_rate=rate)
    return info


def packets(ffmpeg, src, sel, extra, fmt):
    """(dts_us, pts_us, bytes) je Paket: Rohdatei + framecrc aus identischem -c copy."""
    with tempfile.NamedTemporaryFile(suffix="." + fmt, delete=False) as tmp:
        raw_path = tmp.name
    try:
        base = [ffmpeg, "-v", "error", "-y", "-i", src, "-map", sel, "-c", "copy"] + extra
        subprocess.run(base + ["-f", fmt, raw_path], check=True)
        crc = subprocess.run(base + ["-f", "framecrc", "-"], check=True,
                             capture_output=True, text=True).stdout
        raw = open(raw_path, "rb").read()
    finally:
        os.unlink(raw_path)
    tb, rows = None, []
    for line in crc.splitlines():
        if line.startswith("#tb"):
            num, den = line.split(":", 1)[1].strip().split("/")
            tb = Fraction(int(num), int(den))
        elif line and not line.startswith("#"):
            f = [x.strip() for x in line.split(",")]
            dts, pts = int(f[1]), int(f[2])
            pts = pts if pts != INT64_MIN else dts
            rows.append((dts if dts != INT64_MIN else pts, pts, int(f[4])))
    if sum(r[2] for r in rows) != len(raw):
        raise SystemExit(f"{sel}: Paketgroessen ({sum(r[2] for r in rows)}) passen nicht "
                         f"zur Rohdatei ({len(raw)})")
    out, pos = [], 0
    for dts, pts, size in rows:
        out.append((int(dts * tb * 1_000_000), int(pts * tb * 1_000_000), raw[pos:pos + size]))
        pos += size
    return out


def vc1_picture_type(data):
    """Bildtyp aus dem ersten Bild-Startcode (Advanced Profile, progressiv): I, P, B, BI, S."""
    pos = data.find(b"\x00\x00\x01\x0d")
    if pos < 0 or pos + 4 >= len(data):
        return "?"
    b = data[pos + 4]
    if not b & 0x80:
        return "P"
    if not b & 0x40:
        return "B"
    if not b & 0x20:
        return "I"
    return "BI" if not b & 0x10 else "S"


def vc1_is_interlaced(vid):
    """INTERLACE-Bit im Sequenzkopf: nach PROFILE..MAX_CODED_HEIGHT (40 Bit) und PULLDOWN."""
    for _, _, data in vid[:50]:
        pos = data.find(b"\x00\x00\x01\x0f")
        if pos >= 0:
            return bool(data[pos + 4 + 5] & 0x40)
    return False


def vc1_display_times(vid, frame_us):
    """Matroska (VFW-Modus) liefert fuer VC-1 nur fortlaufende Dekodierzeiten, keine PTS.

    Die Anzeigefolge ergibt sich aus den Bildtypen: Ein Ankerbild (I/P) wird erst nach den B-Bildern
    gezeigt, die ihm im Strom folgen. Die Zeitstempel gelten dabei in Anzeigefolge. B-Bilder direkt
    hinter dem ersten I gehoeren zum abgeschnittenen Bildblock davor und fehlen ihr Referenzbild: weg.
    """
    if vc1_is_interlaced(vid):
        raise SystemExit("VC-1 interlaced: Bildtyp-Auswertung nicht umgesetzt")
    types = [vc1_picture_type(d) for _, _, d in vid]
    start = vid[0][1]
    out, skip_leading = [], True
    for i, (dts, _, data) in enumerate(vid):
        if types[i] in ("B", "BI"):
            display = i - 1
            if skip_leading:
                continue
        else:
            if i > 0:
                skip_leading = False
            following = 0
            while i + following + 1 < len(types) and types[i + following + 1] in ("B", "BI"):
                following += 1
            display = i + following
        out.append((dts, int(start + display * frame_us), data))
    print(f"VC-1: {len(vid)} Bilder, {len(vid) - len(out)} vorlaufende B-Bilder verworfen, "
          f"Typen am Anfang: {' '.join(types[:10])}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--ffmpeg", default="ffmpeg")
    a = ap.parse_args()
    a.ffmpeg = shutil.which(a.ffmpeg) or a.ffmpeg
    ffprobe = os.path.join(os.path.dirname(a.ffmpeg), "ffprobe")
    if not os.path.exists(ffprobe) and not os.path.exists(ffprobe + ".exe"):
        ffprobe = shutil.which("ffprobe") or ffprobe

    v = probe(ffprobe, a.ffmpeg, a.src, "v:0", "codec_name,width,height,r_frame_rate")
    vc = v["codec_name"]
    num, den = (int(x) for x in v["r_frame_rate"].split("/"))
    if vc in VBSF:
        vid = packets(a.ffmpeg, a.src, "0:v:0", ["-bsf:v", VBSF[vc]], vc)
    else:  # VC-1, MPEG-2: Pakete tragen ihre Startcodes schon selbst
        vid = packets(a.ffmpeg, a.src, "0:v:0", [], "rawvideo")
    if vc == "vc1" and all(x[1] <= y[1] for x, y in zip(vid, vid[1:])):
        vid = vc1_display_times(vid, 1_000_000 * den / num)

    aud, acodec = [], 0
    au = probe(ffprobe, a.ffmpeg, a.src, "a:0", "codec_name")
    if au.get("codec_name") in ACODEC:
        acodec = ACODEC[au["codec_name"]]
        aud = packets(a.ffmpeg, a.src, "0:a:0", [], au["codec_name"])

    # Jeder Strom bleibt in Dateireihenfolge: Video steht in Dekodierfolge, seine PTS springen bei
    # B-Bildern, und MKV liefert fuer VC-1 keine DTS. Gemischt wird nach Sollzeit der Uebergabe: Video
    # nach Bildnummer, Ton nach PTS. Nie nach PTS sortieren, das zerstoert die Dekodierfolge.
    t0 = min(p for _, p, _ in vid + aud)
    frame_us = 1_000_000 * den / num
    merged = heapq.merge(((i * frame_us, 1, p, b) for i, (_, p, b) in enumerate(vid)),
                         ((p - t0, 0, p, b) for _, p, b in aud), key=lambda r: r[0])
    with open(a.dst, "wb") as f:
        f.write(b"FLXP" + struct.pack("<7I", 1, num, den, VCODEC[vc], acodec,
                                      int(v["width"]), int(v["height"])))
        for _, typ, pts, data in merged:
            f.write(struct.pack("<IIQ", typ, len(data), max(pts - t0, 0)))
            f.write(data)
    print(f"{a.dst}: {vc} {v['width']}x{v['height']} {num}/{den}, {len(vid)} Video-, "
          f"{len(aud)} Tonpakete ({au.get('codec_name', '-')}), {os.path.getsize(a.dst)} Bytes")


if __name__ == "__main__":
    main()
