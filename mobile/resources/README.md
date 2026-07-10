# Mobile resources

For app store submission you need:

- `icon.png` — 1024×1024, square, RGB, no alpha — the master icon.
- `splash.png` — 2732×2732, the brand mark centered (the device crops to the
  visible safe area).

Place those two files here, then run:

```bash
npx capacitor-assets generate
```

…which derives all the per-platform PNGs (iOS xcassets + Android mipmaps and
adaptive icons). The `@capacitor/assets` dev dep is already wired.

Until you drop real assets, Capacitor uses the default placeholder icon
shipped with each platform — fine for dev builds, not for store submission.
