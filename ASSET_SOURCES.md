# Asset sources

Every photo below is from Unsplash, downloaded once at `w=1600` (JPEG) and served locally. All are
marked "Free to use under the Unsplash License" on their photo pages (checked 2026-10-08); none is an
Unsplash+ photo. The Unsplash License allows free use without permission or attribution; credit is
given here anyway. Each image was opened and visually checked after download.

A stock sample never represents a customer's own device: an uploaded product photo always replaces
the fixture photo. Demo procedures in `assets/demo/catalog.json` are authored for SymptomSketch and
make no manufacturer claims.

| File(s)                                                                 | Size      | Creator                  | Photo page                                                                                     | Intended use                                                       |
| ----------------------------------------------------------------------- | --------- | ------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `assets/demo/demo-vacuum.jpg`, `apps/web/public/assets/demo-vacuum.jpg` | 1600x1067 | Kowon vn                 | https://unsplash.com/photos/white-robot-vacuum-cleaner-on-area-rug-7jMiJmNfkgM                 | Robot vacuum fixture: server reference photo + landing product row |
| `assets/demo/demo-fan.jpg`, `apps/web/public/assets/demo-fan.jpg`       | 1600x1067 | Valery Fedotov           | https://unsplash.com/photos/white-and-black-desk-fan-vFWciisio5g                               | Desk fan fixture: server reference photo + landing product row     |
| `assets/demo/demo-drone.jpg`, `apps/web/public/assets/demo-drone.jpg`   | 1600x1200 | Aaron Burden             | https://unsplash.com/photos/white-quadcopter-drone-flying-above-body-of-water-ndzLr2_FQx8      | Camera drone fixture: server reference photo + landing product row |
| `apps/web/public/assets/hero-center.jpg`                                | 1600x1067 | Jakub Żerdzicki          | https://unsplash.com/photos/close-up-of-a-3d-printer-in-operation-IrpcG2ZcOuM                  | Landing hero, center reveal image (magenta and cyan machine scene) |
| `apps/web/public/assets/parallax-fiber.jpg`                             | 1600x1018 | Compare Fibre            | https://unsplash.com/photos/blue-and-white-light-in-dark-room-INNsF0Zz_kQ                      | Landing parallax card, decorative                                  |
| `apps/web/public/assets/parallax-neon.jpg`                              | 1600x1067 | cheng feng               | https://unsplash.com/photos/red-and-blue-neon-lights-DPdwBhwkbPo                               | Landing parallax card, decorative                                  |
| `apps/web/public/assets/parallax-lights.jpg`                            | 1600x2133 | Syed Foyez Uddin         | https://unsplash.com/photos/a-blurry-photo-of-a-street-at-night-9RgYhU4OsVY                    | Landing parallax card, decorative (portrait)                       |
| `apps/web/public/assets/home-interior.jpg`                              | 1600x2400 | Minh Pham                | https://unsplash.com/photos/a-living-room-filled-with-furniture-and-a-large-window-OtXADkUh3-I | Optional landing context (portrait); light palette, off-theme      |
| `apps/web/public/favicon.svg`                                           | 32x32 vb  | SymptomSketch (original) | n/a                                                                                            | Browser tab icon (cyan SS monogram, magenta underline stroke)      |

## Source image ids (for re-download)

Download URL form: `https://images.unsplash.com/<id>?auto=format&fit=crop&fm=jpg&q=80&w=1600`
(the two spec-verified photos use `q=85` for the vacuum and `q=80` for the interior).

| File                | Unsplash image id                |
| ------------------- | -------------------------------- |
| demo-vacuum.jpg     | photo-1558317374-24793bc9f2fb    |
| home-interior.jpg   | photo-1583847268964-b28dc8f51f92 |
| demo-fan.jpg        | photo-1618941716939-553df3c6c278 |
| demo-drone.jpg      | photo-1488248740823-7fa0b1765ebd |
| hero-center.jpg     | photo-1758387933125-5ac945b4e2cd |
| parallax-fiber.jpg  | photo-1606814540563-5c02d62fd409 |
| parallax-neon.jpg   | photo-1562819474-6ccdd832fe2d    |
| parallax-lights.jpg | photo-1684514421739-a345d2d75235 |

## Notes

- Dimensions come from `ffprobe` on the downloaded files and are mirrored in
  `assets/demo/catalog.json` and `apps/web/public/assets/manifest.json`.
- Rejected after visual check: a circuit-board illustration with a large "NFT" label, a green
  circuit-board macro (off-theme), a camera-gear flat lay (not a single product), and a Times
  Square street scene (legible third-party ads).
