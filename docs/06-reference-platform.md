# Reference platform inventory

This is the measured layout of the P0219 reference television. The sizes are rounded.
The mod uses the normal application data and runtime areas. A different firmware or
hardware revision can use another layout.

| Area | Partition on the reference unit | Approx. size | Role |
| --- | --- | --- | --- |
| Root system A/B | p9, p10 | 36 MB each | The live root was p10, read-only squashfs. BusyBox and base configuration |
| `/tvservice` | p18 | 310 MB | Read-only middleware, services, vendor libraries and native applications |
| `/tvconfig`, alias `/config` | p20 | 16 MB | Panel and model settings, media configuration and boot assets |
| `/tvcommon`, `/tvcustomer`, `/tvdatabase` | p21–p23 | 4, 100, 8 MB | Writable common data, set preferences and channels |
| `/usr/local` | p26 | 240 MB | System and TV binaries, stock start scripts, stock boot animation |
| `/usr/local/opt`, alias `/opt` | p28 | 650 MB | Cobalt, browser services and the launcher executable |
| `/var/local` | p29 | 340 MB | Writable user/runtime state and application data |
| `/var/local/tvservice` | p32 | 16 MB | TV-service runtime state |
| `/APPS` | p36 | 600 MB | Application store, launcher assets and mod installation |
| `/OAD` | p37 | 1,000 MB | Firmware download workspace. Kodi used spare capacity for its rebuildable artwork cache |
| `/tmp`, `/var/log`, `/var/crash` | RAM filesystems | Variable | Session IPC, logs and short-lived diagnostics |

The SoC video and graphics drivers are visible as Utopia, XC scaler, GOP/local-dimming and
Mali modules. The control path additionally uses IR evdev, the native launcher and the
service's audio driver. Record capabilities by subsystem. SoC naming alone is insufficient
to assume common library layouts or supported formats.

The firmware contains other boot, modem, identity and certificate areas. Normal mod
backup and restore operate on owned application files and user state. Keep any private
device inventory outside the release tree.
