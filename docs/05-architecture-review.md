# Architecture review and regression record

The split between launcher state, Kodi's player core and the AVR service fits the
reference TV. It keeps independent failure modes observable. Reusing the vendor GUI object,
isolating native media libraries in the ES helper and keeping AVR MAIN state separate from
the TV HDMI state are the key ownership decisions.

## Changes verified in offline tests

| Area | Change |
| --- | --- |
| Denon picture watchdog | Requires a video observation at or after the deadline. Missing metadata and failed refresh leave the selected input alone |
| Denon rename workflow | Prevents auto-refresh and watcher refresh during the rename keyboard |
| Kodi ARC status URL | Reads one line on the reference BusyBox with `awk`. Handles CRLF and an unterminated line |
| Private TV backup validation | Strict manifest comparison in both directions. Reject duplicate, malformed, missing or additional regular entries before reporting success |

These are local source changes. Treat the captured device state as independently versioned.
On the matching TV, verify each source transition before doing a combined Kodi and receiver
regression. Release assets need to pass their own version and checksum checks.

## Other findings

- The ES worker's network read/open and stop/join lifetime should be tested with a stalled
  SMB server. The UI must remain responsive while cancellation is coordinated across demux
  and helper sockets. The ownership fix requires synchronization and runtime tests.
- Route eligibility currently checks DMP audio handling early enough to exclude some
  unsupported DMP formats even if ES audio conversion could handle them. Test regular DMP
  playback, ES fit and silent/fallback behavior together before changing precedence.
- If opening a requested AC-3 transcoder fails, the ES worker should give video an explicit
  silent path and avoid sending unsupported original audio under AC-3 metadata.
- The simulation now distinguishes explicit no signal and missing video metadata. Confirm both states on the real receiver.
- Historical launcher review also identified possible stale slideshow callbacks, alternate
  app launch paths that bypass AVR TV-audio rendezvous, and start failures that the Kodi
  watcher could report too late. Recheck each against the installed version before deployment.
- Repeating remote keys, standby/resume and source handoff matter more than single action tests.
  Cover pause, seek, long-playing local and SMB media, Home restore from DMP and ES, multiple
  CEC playback devices, AVR offline, and returning to the stock player.
