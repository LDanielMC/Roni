# Roni's sounds

This folder is empty on purpose: Roni makes no sound of its own yet. The 29 WAV files
of the original app (Mochi's) are not Roni's to use, so they are not shipped.

- Drop a `.wav` named like one of the sounds in `src/core/sound.ts` (`SOUND_NAMES`) here
  and the build copies it into the app (`vite.config.ts`, `SOUNDS_DIR`).
- Without a file the sound is simply skipped; nothing breaks.
- A user can also put their own files in `%APPDATA%\Roni\sounds`
  (Settings → General → Reload sounds).
