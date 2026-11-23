/*
 * flex_es_probe.c — Go/No-Go-Test fuer echtes 24p (nur Diagnose).
 *
 * Meldet sich wie Netflix als Client beim TV-Mediendienst (MiMwIpcSrv) an, legt ein
 * ES-Media-Item aus Codec-Attributen an (ST_MEDIA_INFO wie libstplayer::createMedia,
 * inklusive Bildrate in +0x5c) und schiebt H.264-/E-AC-3-Pakete per MM_PushPayload.
 * Ob der Dienst dann mit der Inhaltsrate ausgibt, zeigt IRQ 51 (tools/irq24.sh).
 * Hintergrund: docs/kodi/MULTIDECODE-RECHERCHE.md §7d/§7e.
 *
 * Aufruf: flex_es_probe <datei.flxp> [sekunden]
 * Umgebung:
 *   FLEX_AP=<n>         MM_Initialize_APSelect(n) statt MM_Initialize()
 *   FLEX_NOAUDIO=1      keine Tonpakete schieben
 *   FLEX_NOAOUT=1       MI_AOUT_Init nicht aufrufen
 *   FLEX_PTS=90k        PTS in 90 kHz statt Millisekunden
 *   FLEX_LOOPS=<n>      Datei n-mal hintereinander (Standard 1)
 *   FLEX_LEAD_MS=<ms>   so weit vor der Wiedergabe schieben (Standard 500)
 *   FLEX_RESUME_MS=<ms> so lange nach MM_Play MM_SetTrickMode(NORMAL) schicken (Standard -1 = nie;
 *                       Netflix tut das nur beim Fortsetzen nach einer Pause)
 *   FLEX_PREROLL_MS=<ms> Vorlauf vor MM_Play (Standard 1500)
 *   FLEX_INIT_TIMEOUT_MS=<ms> so lange auf INIT_OK warten (Standard 10000)
 *   FLEX_VPTS_LOG=<datei>  alle 50 ms "<CLOCK_MONOTONIC s> <MM_GetVideoPTS>" schreiben; Spruenge darin
 *                       sind fehlende Bilder, die Zeit ist mit dmesg vergleichbar (tools/es24p.py)
 *   FLEX_PLAY=now       MM_Play sofort statt erst nach INIT_OK. Nur zum Nachstellen: mstplayer
 *                       bricht dann ab (CHECK in start(), Zustand 6), der Dienst stirbt.
 *
 * Reihenfolge wie Netflix (libstplayer: readyForPlaybackStart): Item anlegen, Vorlauf schieben,
 * auf E_EVENT_INIT_OK warten, erst dann MM_Play. Danach taktet die Wanduhr die Pakete.
 *   FLEX_SET=off=val,…  ST_MEDIA_INFO-Felder ueberschreiben (32 bit, hex erlaubt)
 *
 * Die Herstellerbibliotheken werden per dlopen geladen (keine Link-Abhaengigkeit);
 * LD_LIBRARY_PATH muss /tvservice/mslib usw. enthalten (tools/es24p.py setzt das).
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <pthread.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

typedef unsigned char (*event_cb)(void *, void *, void *);

static struct {
    void (*ctor)(void *);
    int (*init)(void *);
    int (*apsel)(void *, int);
    int (*addcb)(void *, event_cb);
    int (*delcb)(void *, event_cb);
    int (*create)(void *, const void *, unsigned long *);
    int (*play)(void *, unsigned long);
    int (*stop)(void *, unsigned long);
    int (*del)(void *, unsigned long);
    int (*fin)(void *);
    int (*push)(void *, unsigned long, void *, void *, unsigned long);
    int (*trick)(void *, unsigned long, const void *);
    unsigned long (*vpts)(void *);
    int (*bufinfo)(void *, unsigned long, int, unsigned long *);
    int (*aout)(void *);
} mm;

static const struct { const char *name; void **slot; } syms[] = {
    {"_ZN23MSrv_MM_PlayerInterfaceC1Ev", (void **)&mm.ctor},
    {"_ZN23MSrv_MM_PlayerInterface13MM_InitializeEv", (void **)&mm.init},
    {"_ZN23MSrv_MM_PlayerInterface22MM_Initialize_APSelectE20EN_MM_PLAYER_AP_TYPE", (void **)&mm.apsel},
    {"_ZN23MSrv_MM_PlayerInterface17AddEventRecipientEPFhPvS0_S0_E", (void **)&mm.addcb},
    {"_ZN23MSrv_MM_PlayerInterface20RemoveEventRecipientEPFhPvS0_S0_E", (void **)&mm.delcb},
    {"_ZN23MSrv_MM_PlayerInterface18MM_CreateMediaItemERK13ST_MEDIA_INFOPm", (void **)&mm.create},
    {"_ZN23MSrv_MM_PlayerInterface7MM_PlayEm", (void **)&mm.play},
    {"_ZN23MSrv_MM_PlayerInterface7MM_StopEm", (void **)&mm.stop},
    {"_ZN23MSrv_MM_PlayerInterface18MM_DeleteMediaItemEm", (void **)&mm.del},
    {"_ZN23MSrv_MM_PlayerInterface11MM_FinalizeEv", (void **)&mm.fin},
    {"_ZN23MSrv_MM_PlayerInterface14MM_PushPayloadEmP21ST_MMPLAYER_DATA_INFOPvm", (void **)&mm.push},
    {"_ZN23MSrv_MM_PlayerInterface15MM_SetTrickModeEmRK13ST_TRICK_INFO", (void **)&mm.trick},
    {"_ZN23MSrv_MM_PlayerInterface14MM_GetVideoPTSEv", (void **)&mm.vpts},
    {"_ZN23MSrv_MM_PlayerInterface25MM_GetVideoDataBufferInfoEm27EN_PLAYER_VIDEO_BUFFER_INFOPm", (void **)&mm.bufinfo},
    {"MI_AOUT_Init", (void **)&mm.aout},
};

/* ST_MMPLAYER_DATA_INFO, wie libstplayer::pushVideoSamples/pushAudioSamples es fuellen. */
struct data_info {
    void *addr;
    uint32_t size;
    uint32_t pts;
    uint32_t type; /* 0 = Ton, 1 = Video */
};

/* .flxp (tools/es_pack.py): Kopf, dann Pakete {type, size, pts_us} + Daten. */
struct flxp_head {
    char magic[4];
    uint32_t version, fps_num, fps_den, vcodec, acodec, width, height;
};
struct flxp_rec {
    uint32_t type, size;
    uint64_t pts_us;
};

#define MEDIA_INFO_SIZE 0x1b0

static double t0;
static volatile sig_atomic_t stop_flag;
static volatile int n_events, st_init_ok;

static double now(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec + ts.tv_nsec / 1e9;
}

/* Erst formatieren, dann schreiben: ein blockierender Aufruf in den Argumenten hinterlaesst so
 * keine halbe Zeile, und Zeilen mehrerer Threads mischen sich nicht. */
#define LOG(...)                                                          \
    do {                                                                  \
        char lb_[512];                                                    \
        int ln_ = snprintf(lb_, sizeof lb_, "[%8.3f] ", now() - t0);      \
        snprintf(lb_ + ln_, sizeof lb_ - ln_, __VA_ARGS__);               \
        fprintf(stderr, "%s\n", lb_);                                     \
    } while (0)

/* EN_NOTIFY_EVENT in der Reihenfolge der Namenstabelle von libstplayer. */
static const char *const event_names[] = {
    "FILE_READ", "FILE_SEEK", "FILE_TELL", "INIT_OK", "INIT_FAIL", "INVALID_FILE",
    "THUMBNAIL_DONE", "THUMBNAIL_ERROR", "DECODE_ERROR", "DECODE_DONE",
    "DECODE_FIRST_FRAME_DONE", "DECODE_BACKWARD_TO_FILE_START", "INTERNAL_SUBTITLE_TYPE_TEXT",
    "PROGRAM_CHANGED", "AUDIO_TRACK_CHANGED", "DEMUX_HEADER_OK", "DEMUX_HEADER_FAIL",
    "AUDIO_UNSUPPORTED", "NOT_SUPPORT", "PLAYING_OK", "AUDIO_ONLY", "SETPLAYPOSITION_ACK",
    "SETTRICKMODE_ACK", "DISPLAY_RDY", "ES_FLUSH_DATA_RDY", "SETTITLEID_ACK",
    "SETEDITIONID_ACK", "SETCHAPTERID_ACK", "SETAUTOCHAPTERID_ACK", "DTCPINFO_FOUND",
    "DEMUXRESETADVANCE_ACK", "GET_NEXT_FRAGMENT_ACK", "TEXTURE_FRAMEBUFFER_ALLOCATE",
    "TEXTURE_FRAMEBUFFER_RENDER", "VIDEO_DECODER_START",
};

static void on_signal(int sig) {
    (void)sig;
    stop_flag = 1;
}

static void on_crash(int sig) {
    static const char msg[] = "flex_es_probe: Absturz (Signal)\n";
    (void)sig;
    write(2, msg, sizeof msg - 1);
    _exit(4);
}

static void *play_obj;
static unsigned long play_item;
static double play_at, run_start, run_limit;

static void *play_thread(void *arg) {
    (void)arg;
    play_at = now();
    LOG("MM_Play ...");
    LOG("MM_Play -> %d", mm.play(play_obj, play_item));
    return NULL;
}

/* Status im Sekundentakt aus eigenem Thread: zeigt auch, wenn der Push-Thread blockiert.
 * Der Thread schickt auch SetTrickMode(NORMAL) und beim Ende MM_Stop: ein Push, der im Dienst
 * auf Pufferplatz wartet, kommt erst danach zurueck (kill -9 mitten im Push legte den Dienst
 * lahm). */
static volatile unsigned long st_pushed[2], st_failed[2], st_last_pts[2];
static volatile int st_in_push, st_stopped;
static volatile unsigned long st_late, st_retries;

static void start_play(void);

/* Wiedergabeposition mitschreiben: eigener Thread, damit ein langsamer Dienst-Aufruf den Status nicht bremst. */
static void *vpts_thread(void *arg) {
    FILE *f = fopen((const char *)arg, "w");
    if (!f)
        return NULL;
    unsigned n = 0;
    while (!stop_flag) {
        if (play_at > 0) {
            double t = now();
            unsigned long v = mm.vpts(play_obj);
            fprintf(f, "%.3f %lu\n", t, v);
            /* Puffer je Sekunde, Arten wie libstplayer::callbackRun: 1 und 3 (dort als Groesse und Zeit genutzt).
             * Waechst die Zeit im Puffer, faellt der Decoder zurueck. */
            if (++n % 20 == 0 && !stop_flag) {
                unsigned long bytes = 0, ms = 0;
                mm.bufinfo(play_obj, play_item, 1, &bytes);
                mm.bufinfo(play_obj, play_item, 3, &ms);
                fprintf(f, "B %.3f %lu %lu\n", t, bytes, ms);
            }
            fflush(f);
        }
        usleep(50000);
    }
    fclose(f);
    return NULL;
}

static void *status_thread(void *arg) {
    long resume_ms = (long)arg;
    int resumed = resume_ms < 0;
    int play_pending = !getenv("FLEX_PLAY") || strcmp(getenv("FLEX_PLAY"), "now");
    const char *to = getenv("FLEX_INIT_TIMEOUT_MS");
    double init_timeout = (to ? atof(to) : 10000) / 1000.0;
    while (!stop_flag) {
        usleep(50000);
        double t = now();
        if (run_limit > 0 && t - run_start > run_limit)
            stop_flag = 1;
        if (play_pending && st_init_ok) {
            play_pending = 0;
            LOG("INIT_OK da, jetzt MM_Play");
            start_play();
        } else if (play_pending && t - run_start > init_timeout) {
            LOG("kein INIT_OK nach %.1f s, Abbruch ohne MM_Play", init_timeout);
            play_pending = 0;
            stop_flag = 1;
        }
        if (!resumed && play_at > 0 && t - play_at >= resume_ms / 1000.0) {
            static const uint32_t normal[2] = {0, 1}; /* E_PLAYER_TRICKMODE_NORMAL, wie Netflix */
            resumed = 1;
            LOG("MM_SetTrickMode(NORMAL) ...");
            LOG("MM_SetTrickMode(NORMAL) -> %d", mm.trick(play_obj, play_item, normal));
        }
        static double next;
        if (t < next)
            continue;
        next = t + 1;
        /* Keine Dienst-Aufrufe hier: solange MM_Play im Dienst wartet, blockieren sie. */
        LOG("status: video %lu (%lu fehl, pts %lu), audio %lu (%lu fehl, pts %lu), events %d, "
            "in_push %d, zu spaet %lu, wiederholt %lu",
            st_pushed[1], st_failed[1], st_last_pts[1], st_pushed[0], st_failed[0], st_last_pts[0],
            n_events, st_in_push, st_late, st_retries);
    }
    LOG("Ende angefordert: MM_Stop -> %d", mm.stop(play_obj, play_item));
    st_stopped = 1;
    return NULL;
}

static void start_play(void) {
    pthread_t t;
    if (pthread_create(&t, NULL, play_thread, NULL) == 0)
        pthread_detach(t);
    else
        LOG("pthread_create fuer MM_Play gescheitert");
}

static unsigned char on_event(void *a, void *ev, void *data) {
    const unsigned long *d = data;
    unsigned long e = (unsigned long)ev;
    const char *name = e < sizeof event_names / sizeof event_names[0] ? event_names[e] : "?";
    n_events++;
    if (e == 3)
        st_init_ok = 1;
    if (d)
        LOG("event %lu %s (a=%p) data=[%#lx %#lx]", e, name, a, d[0], d[1]);
    else
        LOG("event %lu %s (a=%p) data=NULL", e, name, a);
    return 1;
}

static long env_long(const char *key, long dflt) {
    const char *v = getenv(key);
    return v && *v ? strtol(v, NULL, 0) : dflt;
}

static void put32(unsigned char *p, unsigned off, uint32_t v) {
    memcpy(p + off, &v, 4);
}

/* Wie libstplayer::PlayerImp::createMedia (0x8bcc); Bedeutungen siehe §7e. */
static void fill_media_info(unsigned char *mi, const struct flxp_head *h) {
    memset(mi, 0, MEDIA_INFO_SIZE);
    put32(mi, 0x00, 0x00010012);     /* Version */
    put32(mi, 0x04, 0x55aa5a5a);     /* Magic */
    put32(mi, 0x08, MEDIA_INFO_SIZE);
    put32(mi, 0x10, 1);
    put32(mi, 0x20, 0xffffffff);     /* 64 bit -1 */
    put32(mi, 0x24, 0xffffffff);
    put32(mi, 0x28, 2);
    put32(mi, 0x2c, 3);
    put32(mi, 0x48, 0x802);
    put32(mi, 0x50, h->vcodec);      /* H.264 = 7, HEVC = 0x14, VP9 = 0x15 */
    if (h->fps_num && h->fps_den)
        put32(mi, 0x5c, (uint32_t)(1000ull * h->fps_num / h->fps_den));
    mi[0x62] = 1;
    mi[0x64] = 4;
    mi[0x65] = 1;
    put32(mi, 0xa0, h->acodec);      /* 5 = E-AC-3 (AC3P), 6 = AAC */
    put32(mi, 0xa4, 1);
    put32(mi, 0xa8, 9);
    /* +0xbc Steuer-Flags: Netflix setzt sie nur fuer den geschuetzten Pfad. */

    const char *set = getenv("FLEX_SET");
    while (set && *set) {
        char *end;
        unsigned long off = strtoul(set, &end, 0);
        if (*end != '=')
            break;
        unsigned long val = strtoul(end + 1, &end, 0);
        if (off + 4 <= MEDIA_INFO_SIZE)
            put32(mi, (unsigned)off, (uint32_t)val);
        LOG("FLEX_SET +%#lx = %#lx", off, val);
        set = *end == ',' ? end + 1 : end + strlen(end);
    }
}

int main(int argc, char **argv) {
    t0 = now();
    setvbuf(stderr, NULL, _IOLBF, 0);
    if (argc < 2) {
        fprintf(stderr, "Aufruf: %s <datei.flxp> [sekunden]\n", argv[0]);
        return 2;
    }
    double limit = argc > 2 ? atof(argv[2]) : 0;

    /* Pakete werden einzeln gelesen: Ein ganzer Film passt nicht in den RAM des TVs. Die Eingabe darf
     * auch ein FIFO sein, in das der PC streamt (tools/es24p.py --stream). */
    FILE *in = fopen(argv[1], "rb");
    struct flxp_head h;
    if (!in || fread(&h, sizeof h, 1, in) != 1 || memcmp(h.magic, "FLXP", 4)) {
        LOG("keine gueltige .flxp-Datei: %s", argv[1]);
        return 2;
    }
    setvbuf(in, NULL, _IOFBF, 1 << 20);
    LOG("flxp v%u %ux%u %u/%u fps vcodec=%#x acodec=%u",
        h.version, h.width, h.height, h.fps_num, h.fps_den, h.vcodec, h.acodec);

    signal(SIGINT, on_signal);
    signal(SIGTERM, on_signal);
    signal(SIGSEGV, on_crash);
    signal(SIGBUS, on_crash);
    signal(SIGILL, on_crash);

    /* Reihenfolge wie die DT_NEEDED von mm_test: liblinux.so braucht MDrv_AUTH_IPCheck
     * aus libdrvIPAUTH.so, die selbst niemand als Abhaengigkeit nennt. */
    static const char *const libs[] = {"libdrvIPAUTH.so", "libmsrv_mmplayer_ipc.so"};
    void *lib = NULL;
    for (size_t i = 0; i < sizeof libs / sizeof libs[0]; i++) {
        lib = dlopen(libs[i], RTLD_NOW | RTLD_GLOBAL);
        if (!lib) {
            LOG("dlopen: %s", dlerror());
            return 3;
        }
    }
    for (size_t i = 0; i < sizeof syms / sizeof syms[0]; i++) {
        *syms[i].slot = dlsym(lib, syms[i].name);
        if (!*syms[i].slot) {
            LOG("Symbol fehlt: %s", syms[i].name);
            return 3;
        }
    }

    if (!getenv("FLEX_NOAOUT")) {
        /* MI_AOUT_InitParams: u16SizeofStructure an +0, sonst "unknown error". */
        static unsigned char aout_params[256];
        aout_params[0] = sizeof aout_params & 0xff;
        aout_params[1] = sizeof aout_params >> 8;
        LOG("MI_AOUT_Init -> %d", mm.aout(aout_params));
    }

    void *obj = calloc(1, 4096); /* mm_test: operator new(0x40); grosszuegig */
    mm.ctor(obj);
    long ap = env_long("FLEX_AP", -1);
    int rc = ap >= 0 ? mm.apsel(obj, (int)ap) : mm.init(obj);
    LOG("%s -> %d", ap >= 0 ? "MM_Initialize_APSelect" : "MM_Initialize", rc);
    LOG("AddEventRecipient -> %d", mm.addcb(obj, on_event));

    /* Verbindung pruefen: MMPlayer::connect() holt per getService("mstar.mmplayer") den Dienst
     * und per service->connect(client) einen eigenen IMMPlayer-Proxy (MMPlayer +0x154). Fehlt
     * der Proxy, scheitert MM_CreateMediaItem still mit 1. */
    void **svc = dlsym(lib, "_ZN8MMPlayer16mMMPlayerServiceE");
    void **player = dlsym(lib, "mmplayer");
    void *proxy = player && *player ? *(void **)((char *)*player + 0x154) : NULL;
    LOG("Verbindung: Dienst=%p MMPlayer=%p Proxy=%p", svc ? *svc : NULL,
        player ? *player : NULL, proxy);

    static unsigned char mi[MEDIA_INFO_SIZE];
    fill_media_info(mi, &h);
    for (unsigned off = 0; off < MEDIA_INFO_SIZE; off += 4) {
        uint32_t v;
        memcpy(&v, mi + off, 4);
        if (v)
            LOG("  media_info +%#05x = %#x", off, v);
    }
    unsigned long item = 0;
    rc = mm.create(obj, mi, &item);
    LOG("MM_CreateMediaItem -> %d, item=%#lx", rc, item);
    if (!item) {
        LOG("kein Media-Item, Abbruch");
        goto finalize;
    }

    play_obj = obj;
    play_item = item;
    if (getenv("FLEX_PLAY") && !strcmp(getenv("FLEX_PLAY"), "now"))
        start_play();

    int pts90k = getenv("FLEX_PTS") && !strcmp(getenv("FLEX_PTS"), "90k");
    int noaudio = getenv("FLEX_NOAUDIO") != NULL;
    long loops = env_long("FLEX_LOOPS", 1);
    double lead = env_long("FLEX_LEAD_MS", 500) / 1000.0;
    double preroll = env_long("FLEX_PREROLL_MS", 1500) / 1000.0;
    uint64_t frame_us = h.fps_num ? 1000000ull * h.fps_den / h.fps_num : 41708;

    /* Dauer einer Runde = letzte Video-PTS + ein Bild (nur fuer FLEX_LOOPS, braucht eine Datei). */
    uint64_t round_us = 0;
    if (loops > 1) {
        struct flxp_rec r;
        while (fread(&r, sizeof r, 1, in) == 1 && !fseek(in, (long)r.size, SEEK_CUR))
            if (r.type == 1 && r.pts_us + frame_us > round_us)
                round_us = r.pts_us + frame_us;
        fseek(in, sizeof h, SEEK_SET);
    }
    unsigned char *data = NULL;
    size_t cap = 0;

    unsigned long *pushed = (unsigned long *)st_pushed, *failed = (unsigned long *)st_failed;
    int last_rc[2] = {0x7fffffff, 0x7fffffff};
    double start = now();
    run_start = start;
    run_limit = limit;
    pthread_t st;
    pthread_create(&st, NULL, status_thread, (void *)env_long("FLEX_RESUME_MS", -1));
    pthread_detach(st);
    pthread_t vt;
    int have_vt = getenv("FLEX_VPTS_LOG") &&
                  !pthread_create(&vt, NULL, vpts_thread, (void *)getenv("FLEX_VPTS_LOG"));
    for (long loop = 0; loop < loops && !stop_flag; loop++) {
        if (loop && fseek(in, sizeof h, SEEK_SET))
            break;
        struct flxp_rec r;
        while (!stop_flag && fread(&r, sizeof r, 1, in) == 1) {
            if (r.size > cap) {
                unsigned char *grown = realloc(data, r.size);
                if (!grown) {
                    LOG("kein Speicher fuer Paket mit %u Bytes", r.size);
                    stop_flag = 1;
                    break;
                }
                data = grown;
                cap = r.size;
            }
            if (fread(data, 1, r.size, in) != r.size)
                break;
            if (r.type > 1 || (r.type == 0 && noaudio))
                continue;

            uint64_t pts_us = r.pts_us + (uint64_t)loop * round_us;
            double pts_s = pts_us / 1e6;
            /* Vor MM_Play nur den Vorlauf schieben, danach nach Wanduhr. */
            while (!stop_flag) {
                if (play_at > 0 ? now() >= play_at + pts_s - lead : pts_s <= preroll)
                    break;
                usleep(5000);
            }
            if (stop_flag)
                break;
            /* Paket erst nach seinem Anzeigezeitpunkt da: Daten kommen zu langsam nach. */
            if (play_at > 0 && now() > play_at + pts_s)
                st_late++;

            struct data_info di = {
                .addr = data,
                .size = r.size,
                .pts = (uint32_t)(pts90k ? pts_us * 9 / 100 : pts_us / 1000),
                .type = r.type,
            };
            st_in_push = 1;
            /* Bilddaten laufen nur ueber di.addr (Shared Memory der Client-Bibliothek). Die beiden letzten Argumente
             * sind Zusatzdaten im Binder-Paket: Dort scheitert alles ab rund 1,04 MB still (ENOSPC, rc bleibt 0). */
            rc = mm.push(obj, item, &di, NULL, 0);
            /* Abgelehnt, etwa weil der ES-Puffer voll ist: wie libstplayer ("sample retry") kurz warten, Bild behalten. */
            for (int tries = 0; rc != 0 && tries < 40 && !stop_flag; tries++) {
                st_retries++;
                usleep(5000);
                rc = mm.push(obj, item, &di, NULL, 0);
            }
            st_in_push = 0;
            st_last_pts[r.type] = di.pts;
            pushed[r.type]++;
            if (rc != last_rc[r.type] || pushed[r.type] <= 3) {
                LOG("PushPayload %s #%lu pts=%u size=%u -> %d", r.type ? "video" : "audio",
                    pushed[r.type], di.pts, di.size, rc);
                last_rc[r.type] = rc;
            }
            if (rc != 0)
                failed[r.type]++;
        }
    }
    LOG("Daten zu Ende (stop=%d), Nachlauf 2 s", (int)stop_flag);
    for (int i = 0; i < 20 && !stop_flag; i++)
        usleep(100000);
    LOG("Ende: video %lu (%lu fehl), audio %lu (%lu fehl)", pushed[1], failed[1], pushed[0],
        failed[0]);

    stop_flag = 1; /* Status-Thread schickt MM_Stop */
    for (int i = 0; i < 100 && !st_stopped; i++)
        usleep(100000);
    if (have_vt)
        pthread_join(vt, NULL);
    LOG("MM_DeleteMediaItem -> %d", mm.del(obj, item));
finalize:
    LOG("RemoveEventRecipient -> %d", mm.delcb(obj, on_event));
    LOG("MM_Finalize -> %d", mm.fin(obj));
    return 0;
}
