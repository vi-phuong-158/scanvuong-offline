# Vigil Lens — UX Browser Acceptance

## Nghiệm thu

- Ngày: 2026-09-08
- OS: Windows local
- Browser: Google Chrome 152.0.7977.76
- Executable: `C:\Program Files\Google\Chrome\Application\chrome.exe`
- Repository: `scanvuong-offline`
- Starting HEAD: `a24cfe4aef6abf80561039a59c2ce599882d1ac3`
- Branch: `main`
- App URL used by final screenshot harness: `http://127.0.0.1:8781/`
- Desktop viewport: `1440x900`
- Mobile viewport: `390x844`; Help also verified at `360x800`

## Screenshot evidence

- [home-desktop.png](docs/screenshots/home-desktop.png)
- [home-mobile.png](docs/screenshots/home-mobile.png)
- [party-scan-empty.png](docs/screenshots/party-scan-empty.png)
- [party-scan-preview.png](docs/screenshots/party-scan-preview.png)
- [footer-cleaner.png](docs/screenshots/footer-cleaner.png)
- [help-mobile.png](docs/screenshots/help-mobile.png)

## Results

- Help IA browser acceptance: PASS, 22/22; no console errors; global Help entry, Party deep-link, session preservation, and 360/390 mobile overflow all pass.
- Party browser acceptance: PASS; desktop/mobile workspaces, real 13-page PDF import/export, preview lifecycle, lazy thumbnails, corrupt/encrypted rejection, and navigation pass.
- Scan ID browser acceptance: PASS, 17/17; oversized 6000x3783 fixture renders and exports one A4 portrait PDF without flip/mirror; no console errors.
- Touch target audit: PASS, 175/175 after fixing `#helpBtn` from 38px to 44px wide on mobile.
- Footer Cleaner regression: PASS, 35/35; browser result state captured in `footer-cleaner.png`.
- Export/busy regression: PASS, 29/29; Scan ID and Party browser exports pass.
- Static/privacy validation: PASS, 10/10.
- Service Worker and offline PWA browser acceptance: PASS; Phase A and Phase B passed (registration, 18/18 required precache assets, fonts, manifest, offline SCANIC_ML detection, Document mode, Scan ID mode, 0 external third-party requests, 0 uncached required runtime failures). Native OS install prompt remains a headless limitation.

## Change made during acceptance

- `styles.css`: added `min-width: 44px` to narrow topbar compact buttons so the global Help control satisfies the required mobile touch target without changing application behavior.

## Verdict

`VIGIL_LENS_SIMPLE_UX_PASS`

Local Chrome ran successfully; desktop, mobile, functional smoke, offline, and regression gates passed.

## Scope confirmation

No PDF engine, business logic, taxonomy, detection algorithm, compression algorithm, or persistent/network behavior was changed.
